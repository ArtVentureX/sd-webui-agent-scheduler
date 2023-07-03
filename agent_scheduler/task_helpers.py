import os
import io
import zlib
import base64
import inspect
import requests
import numpy as np
from typing import Union
from enum import Enum
from PIL import Image, ImageOps, ImageChops, ImageEnhance, ImageFilter

from modules import sd_samplers, scripts
from modules.generation_parameters_copypaste import create_override_settings_dict
from modules.sd_models import CheckpointInfo, get_closet_checkpoint_match
from modules.txt2img import txt2img
from modules.img2img import img2img
from modules.api.models import (
    StableDiffusionTxt2ImgProcessingAPI,
    StableDiffusionImg2ImgProcessingAPI,
)

from .helpers import log, get_dict_attribute

img2img_image_args_by_mode: dict[int, list[list[str]]] = {
    0: [["init_img"]],
    1: [["sketch"]],
    2: [["init_img_with_mask", "image"], ["init_img_with_mask", "mask"]],
    3: [["inpaint_color_sketch"], ["inpaint_color_sketch_orig"]],
    4: [["init_img_inpaint"], ["init_mask_inpaint"]],
}


def get_script_by_name(
    script_name: str, is_img2img: bool = False, is_always_on: bool = False
) -> scripts.Script:
    script_runner = scripts.scripts_img2img if is_img2img else scripts.scripts_txt2img
    available_scripts = (
        script_runner.alwayson_scripts
        if is_always_on
        else script_runner.selectable_scripts
    )

    return next(
        (s for s in available_scripts if s.title().lower() == script_name.lower()),
        None,
    )


def load_image_from_url(url: str):
    try:
        response = requests.get(url)
        buffer = io.BytesIO(response.content)
        return Image.open(buffer)
    except Exception as e:
        log.error(f"[AgentScheduler] Error downloading image from url: {e}")
        return None


def encode_image_to_base64(image):
    if isinstance(image, np.ndarray):
        image = Image.fromarray(image.astype("uint8"))
    elif isinstance(image, str):
        if image.startswith("http://") or image.startswith("https://"):
            image = load_image_from_url(image)

    if not isinstance(image, Image.Image):
        return image

    with io.BytesIO() as output_bytes:
        image.save(output_bytes, format="PNG")
        bytes_data = output_bytes.getvalue()
        return "data:image/png;base64," + base64.b64encode(bytes_data).decode("utf-8")


def serialize_image(image):
    if isinstance(image, np.ndarray):
        shape = image.shape
        data = base64.b64encode(zlib.compress(image.tobytes())).decode()
        return {"shape": shape, "data": data, "cls": "ndarray"}
    elif isinstance(image, Image.Image):
        size = image.size
        mode = image.mode
        data = base64.b64encode(zlib.compress(image.tobytes())).decode()
        return {
            "size": size,
            "mode": mode,
            "data": data,
            "cls": "Image",
        }
    else:
        return image


def deserialize_image(image_str):
    if isinstance(image_str, dict) and image_str.get("cls", None):
        cls = image_str["cls"]
        data = zlib.decompress(base64.b64decode(image_str["data"]))

        if cls == "ndarray":
            shape = tuple(image_str["shape"])
            image = np.frombuffer(data, dtype=np.uint8)
            return image.reshape(shape)
        else:
            size = tuple(image_str["size"])
            mode = image_str["mode"]
            return Image.frombytes(mode, size, data)
    else:
        return image_str


def serialize_img2img_image_args(args: dict):
    for mode, image_args in img2img_image_args_by_mode.items():
        for keys in image_args:
            if mode != args["mode"]:
                # set None to unused image args to save space
                args[keys[0]] = None
            elif len(keys) == 1:
                image = args.get(keys[0], None)
                args[keys[0]] = serialize_image(image)
            else:
                value = args.get(keys[0], {})
                image = value.get(keys[1], None)
                value[keys[1]] = serialize_image(image)
                args[keys[0]] = value


def deserialize_img2img_image_args(args: dict):
    for mode, image_args in img2img_image_args_by_mode.items():
        if mode != args["mode"]:
            continue

        for keys in image_args:
            if len(keys) == 1:
                image = args.get(keys[0], None)
                args[keys[0]] = deserialize_image(image)
            else:
                value = args.get(keys[0], {})
                image = value.get(keys[1], None)
                value[keys[1]] = deserialize_image(image)
                args[keys[0]] = value


def serialize_controlnet_args(cnet_unit):
    args: dict = cnet_unit.__dict__
    args["is_cnet"] = True
    for k, v in args.items():
        if k == "image" and v is not None:
            args[k] = {
                "image": serialize_image(v["image"]),
                "mask": serialize_image(v["mask"])
                if v.get("mask", None) is not None
                else None,
            }
        if isinstance(v, Enum):
            args[k] = v.value

    return args


def deserialize_controlnet_args(args: dict):
    for k, v in args.items():
        if k == "image" and v is not None:
            args[k] = {
                "image": deserialize_image(v["image"]),
                "mask": deserialize_image(v["mask"])
                if v.get("mask", None) is not None
                else None,
            }

    return args


def map_controlnet_args_to_api_task_args(args: dict):
    if type(args).__name__ == "UiControlNetUnit":
        args = args.__dict__

    for k, v in args.items():
        if k == "image" and v is not None:
            args[k] = {
                "image": encode_image_to_base64(v["image"]),
                "mask": encode_image_to_base64(v["mask"])
                if v.get("mask", None) is not None
                else None,
            }
        if isinstance(v, Enum):
            args[k] = v.value

    return args


def map_ui_task_args_list_to_named_args(
    args: list, is_img2img: bool, checkpoint: str = None
):
    args_name = []
    if is_img2img:
        args_name = inspect.getfullargspec(img2img).args
    else:
        args_name = inspect.getfullargspec(txt2img).args

    named_args = dict(zip(args_name, args[0 : len(args_name)]))
    script_args = args[len(args_name) :]
    if checkpoint is not None:
        override_settings_texts = named_args.get("override_settings_texts", [])
        override_settings_texts.append("Model hash: " + checkpoint)
        named_args["override_settings_texts"] = override_settings_texts

    sampler_index = named_args.get("sampler_index", None)
    if sampler_index is not None:
        available_samplers = (
            sd_samplers.samplers_for_img2img if is_img2img else sd_samplers.samplers
        )
        sampler_name = available_samplers[named_args["sampler_index"]].name
        named_args["sampler_name"] = sampler_name
        log.debug(f"serialize sampler index: {str(sampler_index)} as {sampler_name}")

    return (
        named_args,
        script_args,
    )


def map_named_args_to_ui_task_args_list(
    named_args: dict, script_args: list, is_img2img: bool
):
    args_name = []
    if is_img2img:
        args_name = inspect.getfullargspec(img2img).args
    else:
        args_name = inspect.getfullargspec(txt2img).args

    sampler_name = named_args.get("sampler_name", None)
    if sampler_name is not None:
        available_samplers = (
            sd_samplers.samplers_for_img2img if is_img2img else sd_samplers.samplers
        )
        sampler_index = next(
            (i for i, x in enumerate(available_samplers) if x.name == sampler_name), 0
        )
        named_args["sampler_index"] = sampler_index

    args = [named_args.get(name, None) for name in args_name]
    args.extend(script_args)

    return args


def map_script_args_list_to_named(script: scripts.Script, args: list):
    script_name = script.title().lower()
    print("script", script_name, "is alwayson", script.alwayson)

    if script_name == "controlnet":
        for i, cnet_args in enumerate(args):
            args[i] = map_controlnet_args_to_api_task_args(cnet_args)

        return args

    fn = script.process if script.alwayson else script.run
    inspection = inspect.getfullargspec(fn)
    arg_names = inspection.args[2:]
    named_script_args = dict(zip(arg_names, args[: len(arg_names)]))
    if inspection.varargs is not None:
        named_script_args[inspection.varargs] = args[len(arg_names) :]

    return named_script_args


def map_named_script_args_to_list(
    script: scripts.Script, named_args: Union[dict, list]
):
    script_name = script.title().lower()

    if isinstance(named_args, dict):
        fn = script.process if script.alwayson else script.run
        inspection = inspect.getfullargspec(fn)
        arg_names = inspection.args[2:]
        args = [named_args.get(name, None) for name in arg_names]
        if inspection.varargs is not None:
            args.extend(named_args.get(inspection.varargs, []))

        return args

    if isinstance(named_args, list):
        if script_name == "controlnet":
            for i, cnet_args in enumerate(named_args):
                named_args[i] = map_controlnet_args_to_api_task_args(cnet_args)

        return named_args


def map_ui_task_args_to_api_task_args(
    named_args: dict, script_args: list, is_img2img: bool
):
    api_task_args: dict = named_args.copy()

    prompt_styles = api_task_args.pop("prompt_styles", [])
    api_task_args["styles"] = prompt_styles

    sampler_index = api_task_args.pop("sampler_index", 0)
    api_task_args["sampler_name"] = sd_samplers.samplers[sampler_index].name

    override_settings_texts = api_task_args.pop("override_settings_texts", [])
    api_task_args["override_settings"] = create_override_settings_dict(
        override_settings_texts
    )

    if is_img2img:
        mode = api_task_args.pop("mode", 0)
        for arg_mode, image_args in img2img_image_args_by_mode.items():
            if mode != arg_mode:
                for keys in image_args:
                    api_task_args.pop(keys[0], None)

        # the logic below is copied from modules/img2img.py
        if mode == 0:
            image = api_task_args.pop("init_img")
            image = image.convert("RGB") if image else None
            mask = None
        elif mode == 1:
            image = api_task_args.pop("sketch")
            image = image.convert("RGB") if image else None
            mask = None
        elif mode == 2:
            init_img_with_mask: dict = api_task_args.pop("init_img_with_mask") or {}
            image = init_img_with_mask.get("image", None)
            image = image.convert("RGB") if image else None
            mask = init_img_with_mask.get("mask", None)
            if mask:
                alpha_mask = (
                    ImageOps.invert(image.split()[-1])
                    .convert("L")
                    .point(lambda x: 255 if x > 0 else 0, mode="1")
                )
                mask = ImageChops.lighter(alpha_mask, mask.convert("L")).convert("L")
        elif mode == 3:
            image = api_task_args.pop("inpaint_color_sketch")
            orig = api_task_args.pop("inpaint_color_sketch_orig") or image
            if image is not None:
                mask_alpha = api_task_args.pop("mask_alpha", 0)
                mask_blur = api_task_args.get("mask_blur", 4)
                pred = np.any(np.array(image) != np.array(orig), axis=-1)
                mask = Image.fromarray(pred.astype(np.uint8) * 255, "L")
                mask = ImageEnhance.Brightness(mask).enhance(1 - mask_alpha / 100)
                blur = ImageFilter.GaussianBlur(mask_blur)
                image = Image.composite(image.filter(blur), orig, mask.filter(blur))
                image = image.convert("RGB")
        elif mode == 4:
            image = api_task_args.pop("init_img_inpaint")
            mask = api_task_args.pop("init_mask_inpaint")
        else:
            raise Exception(f"Batch mode is not supported yet")

        image = ImageOps.exif_transpose(image) if image else None
        api_task_args["init_images"] = [encode_image_to_base64(image)] if image else []
        api_task_args["mask"] = encode_image_to_base64(mask) if mask else None

        selected_scale_tab = api_task_args.pop("selected_scale_tab", 0)
        scale_by = api_task_args.get("scale_by", 1)
        if selected_scale_tab == 1 and image:
            api_task_args["width"] = int(image.width * scale_by)
            api_task_args["height"] = int(image.height * scale_by)
    else:
        hr_sampler_index = api_task_args.pop("hr_sampler_index", 0)
        api_task_args["hr_sampler_name"] = (
            sd_samplers.samplers_for_img2img[hr_sampler_index - 1].name
            if hr_sampler_index != 0
            else None
        )

    # script
    script_runner = scripts.scripts_img2img if is_img2img else scripts.scripts_txt2img
    script_id = script_args[0]
    if script_id == 0:
        api_task_args["script_name"] = None
        api_task_args["script_args"] = []
    else:
        script: scripts.Script = script_runner.selectable_scripts[script_id - 1]
        api_task_args["script_name"] = script.title().lower()
        current_script_args = script_args[script.args_from : script.args_to]
        api_task_args["script_args"] = map_script_args_list_to_named(
            script, current_script_args
        )

    # alwayson scripts
    alwayson_scripts = api_task_args.get("alwayson_scripts", None)
    if not alwayson_scripts:
        api_task_args["alwayson_scripts"] = {}
        alwayson_scripts = api_task_args["alwayson_scripts"]

    for script in script_runner.alwayson_scripts:
        alwayson_script_args = script_args[script.args_from : script.args_to]
        script_name = script.title().lower()
        if script_name != "agent scheduler":
            named_script_args = map_script_args_list_to_named(
                script, alwayson_script_args
            )
            alwayson_scripts[script_name] = {"args": named_script_args}

    return api_task_args


def serialize_api_task_args(
    params: dict,
    is_img2img: bool,
    checkpoint: str = None,
):
    # handle named script args
    script_name = params.get("script_name", None)
    if script_name is not None:
        script = get_script_by_name(script_name, is_img2img)
        if script is None:
            raise Exception(f"Not found script {script_name}")

        script_args = params.get("script_args", {})
        params["script_args"] = map_named_script_args_to_list(script, script_args)

    # handle named alwayson script args
    alwayson_scripts = get_dict_attribute(params, "alwayson_scripts", {})
    valid_alwayson_scripts = {}
    script_runner = scripts.scripts_img2img if is_img2img else scripts.scripts_txt2img
    for script in script_runner.alwayson_scripts:
        script_name = script.title().lower()
        if script_name == "agent scheduler":
            continue

        script_args = get_dict_attribute(alwayson_scripts, f"{script_name}.args", None)
        if script_args:
            arg_list = map_named_script_args_to_list(script, script_args)
            valid_alwayson_scripts[script_name] = {"args": arg_list}

    params["alwayson_scripts"] = valid_alwayson_scripts

    args = (
        StableDiffusionImg2ImgProcessingAPI(**params)
        if is_img2img
        else StableDiffusionTxt2ImgProcessingAPI(**params)
    )

    if args.override_settings is None:
        args.override_settings = {}

    if checkpoint is not None:
        checkpoint_info: CheckpointInfo = get_closet_checkpoint_match(checkpoint)
        if not checkpoint_info:
            raise Exception(f"No checkpoint found for model hash {checkpoint}")
        args.override_settings["sd_model_checkpoint"] = checkpoint_info.title

    # load images from url or file if needed
    if is_img2img:
        init_images = args.init_images
        if len(init_images) == 0:
            raise Exception("At least one init image is required")

        for i, image in enumerate(init_images):
            init_images[i] = encode_image_to_base64(image)

        args.mask = encode_image_to_base64(args.mask)
        args.batch_size = len(init_images)

    return args.dict()
