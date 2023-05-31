import os
import io
import zlib
import base64
import inspect
import requests
import numpy as np
from enum import Enum
from PIL import Image, ImageOps, ImageChops, ImageEnhance, ImageFilter
from typing import Optional, List
from pydantic import BaseModel, Field

from modules import sd_samplers, scripts
from modules.generation_parameters_copypaste import create_override_settings_dict
from modules.sd_models import CheckpointInfo, get_closet_checkpoint_match
from modules.txt2img import txt2img
from modules.img2img import img2img
from modules.api.models import (
    StableDiffusionTxt2ImgProcessingAPI,
    StableDiffusionImg2ImgProcessingAPI,
)

from scripts.helpers import log

img2img_image_args_by_mode: dict[int, list[list[str]]] = {
    0: [["init_img"]],
    1: [["sketch"]],
    2: [["init_img_with_mask", "image"], ["init_img_with_mask", "mask"]],
    3: [["inpaint_color_sketch"], ["inpaint_color_sketch_orig"]],
    4: [["init_img_inpaint"], ["init_mask_inpaint"]],
}


class ControlNetImage(BaseModel):
    image: str  # base64 or url
    mask: Optional[str] = None  # base64 or url


class ControlNetUnit(BaseModel):
    enabled: Optional[bool] = True
    module: Optional[str] = "none"
    model: Optional[str] = None
    image: ControlNetImage = None
    weight: Optional[float] = 1.0
    resize_mode: Optional[str] = None
    low_vram: Optional[bool] = False
    processor_res: Optional[int] = 512
    threshold_a: Optional[float] = 64
    threshold_b: Optional[float] = 64
    guidance_start: Optional[float] = 0.0
    guidance_end: Optional[float] = 1.0
    pixel_perfect: Optional[bool] = False
    control_mode: Optional[str] = "Balanced"


class BaseApiTaskArgs(BaseModel):
    task_id: str = Field(exclude=True)
    model_hash: str = Field(exclude=True)
    prompt: Optional[str] = ""
    styles: Optional[List[str]] = []
    negative_prompt: Optional[str] = ""
    seed: Optional[int] = -1
    subseed: Optional[int] = 1
    subseed_strength: Optional[int] = 0
    seed_resize_from_h: Optional[int] = -1
    seed_resize_from_w: Optional[int] = -1
    sampler_name: Optional[str] = "DPM++ 2M Karras"
    n_iter: Optional[int] = 1
    batch_size: Optional[int] = 1
    steps: Optional[int] = 20
    cfg_scale: Optional[int] = 7.0
    restore_faces: Optional[bool] = False
    tiling: Optional[bool] = False
    width: Optional[int] = 512
    height: Optional[int] = 512
    script_name: Optional[str] = None
    controlnet_args: Optional[List[ControlNetUnit]] = Field(exclude=True, default=[])
    override_settings: Optional[dict] = Field(default={})


class Txt2ImgApiTaskArgs(BaseApiTaskArgs):
    enable_hr: Optional[bool] = False
    denoising_strength: Optional[int] = 0
    hr_scale: Optional[int] = 1
    hr_upscaler: Optional[str] = "Latent"
    hr_second_pass_steps: Optional[int] = 0
    hr_resize_x: Optional[int] = 0
    hr_resize_y: Optional[int] = 0


class Img2ImgApiTaskArgs(BaseApiTaskArgs):
    init_images: List[str]
    mask: Optional[str] = None
    resize_mode: Optional[int] = 0
    denoising_strength: Optional[int] = 0.75
    mask_blur: Optional[int] = 4
    inpainting_fill: Optional[int] = 0
    inpaint_full_res: Optional[bool] = True
    inpaint_full_res_padding: Optional[int] = 0
    inpainting_mask_invert: Optional[int] = 0
    initial_noise_multiplier: Optional[float] = 0.0


def load_image_from_url(url: str):
    try:
        response = requests.get(url)
        buffer = io.BytesIO(response.content)
        return Image.open(buffer)
    except Exception as e:
        log.error(f"[AgentScheduler] Error downloading image from url: {e}")
        return None


def load_image(image: str):
    if not isinstance(image, str):
        return image

    pil_image = None
    if os.path.exists(image):
        pil_image = Image.open(image)
    elif image.startswith(("http://", "https://")):
        pil_image = load_image_from_url(image)

    return pil_image


def load_image_to_nparray(image: str):
    pil_image = load_image(image)

    return (
        np.array(pil_image).astype("uint8")
        if isinstance(pil_image, Image.Image)
        else None
    )


def encode_pil_to_base64(image: Image.Image):
    with io.BytesIO() as output_bytes:
        image.save(output_bytes, format="PNG")
        bytes_data = output_bytes.getvalue()
        return base64.b64encode(bytes_data).decode("utf-8")


def load_image_to_base64(image: str):
    pil_image = load_image(image)

    if not isinstance(pil_image, Image.Image):
        return image

    return encode_pil_to_base64(pil_image)


def __serialize_image(image):
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


def __deserialize_image(image_str):
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
                args[keys[0]] = __serialize_image(image)
            else:
                value = args.get(keys[0], {})
                image = value.get(keys[1], None)
                value[keys[1]] = __serialize_image(image)
                args[keys[0]] = value


def deserialize_img2img_image_args(args: dict):
    for mode, image_args in img2img_image_args_by_mode.items():
        if mode != args["mode"]:
            continue

        for keys in image_args:
            if len(keys) == 1:
                image = args.get(keys[0], None)
                args[keys[0]] = __deserialize_image(image)
            else:
                value = args.get(keys[0], {})
                image = value.get(keys[1], None)
                value[keys[1]] = __deserialize_image(image)
                args[keys[0]] = value


def serialize_controlnet_args(cnet_unit):
    args: dict = cnet_unit.__dict__
    args["is_cnet"] = True
    for k, v in args.items():
        if k == "image" and v is not None:
            args[k] = {
                "image": __serialize_image(v["image"]),
                "mask": __serialize_image(v["mask"])
                if v.get("mask", None) is not None
                else None,
            }
        if isinstance(v, Enum):
            args[k] = v.value

    return args


def deserialize_controlnet_args(args: dict):
    # args.pop("is_cnet", None)
    for k, v in args.items():
        if k == "image" and v is not None:
            args[k] = {
                "image": __deserialize_image(v["image"]),
                "mask": __deserialize_image(v["mask"])
                if v.get("mask", None) is not None
                else None,
            }

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

    return (
        named_args,
        script_args,
    )


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
            image = api_task_args.pop("init_img").convert("RGB")
            mask = None
        elif mode == 1:
            image = api_task_args.pop("sketch").convert("RGB")
            mask = None
        elif mode == 2:
            init_img_with_mask: dict = api_task_args.pop("init_img_with_mask")
            image = init_img_with_mask.get("image").convert("RGB")
            mask = init_img_with_mask.get("mask")
            alpha_mask = (
                ImageOps.invert(image.split()[-1])
                .convert("L")
                .point(lambda x: 255 if x > 0 else 0, mode="1")
            )
            mask = ImageChops.lighter(alpha_mask, mask.convert("L")).convert("L")
        elif mode == 3:
            image = api_task_args.pop("inpaint_color_sketch")
            orig = api_task_args.pop("inpaint_color_sketch_orig") or image
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

        image = ImageOps.exif_transpose(image)
        api_task_args["init_images"] = [encode_pil_to_base64(image)]
        api_task_args["mask"] = encode_pil_to_base64(mask) if mask is not None else None

        selected_scale_tab = api_task_args.pop("selected_scale_tab", 0)
        scale_by = api_task_args.pop("scale_by", 1)
        if selected_scale_tab == 1:
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
        script = script_runner.selectable_scripts[script_id - 1]
        api_task_args["script_name"] = script.title.lower()
        api_task_args["script_args"] = script_args[script.args_from : script.args_to]

    # alwayson scripts
    alwayson_scripts = api_task_args.get("alwayson_scripts", None)
    if not alwayson_scripts or not isinstance(alwayson_scripts, dict):
        alwayson_scripts = {}
        api_task_args["alwayson_scripts"] = alwayson_scripts

    for script in script_runner.alwayson_scripts:
        alwayson_script_args = script_args[script.args_from : script.args_to]
        if script.title.lower() == "controlnet":
            for i, cnet_args in enumerate(alwayson_script_args):
                alwayson_script_args[i] = serialize_controlnet_args(cnet_args)

        alwayson_scripts[script.title.lower()] = {"args": alwayson_script_args}

    return api_task_args


def serialize_api_task_args(params: dict, is_img2img: bool):
    # pop out custom params
    model_hash = params.pop("model_hash", None)
    controlnet_args = params.pop("controlnet_args", None)

    args = (
        StableDiffusionImg2ImgProcessingAPI(**params)
        if is_img2img
        else StableDiffusionTxt2ImgProcessingAPI(**params)
    )

    if args.override_settings is None:
        args.override_settings = {}

    if model_hash is None:
        model_hash = args.override_settings.get("sd_model_checkpoint", None)

    if model_hash is None:
        log.error("[AgentScheduler] API task must supply model hash")
        return

    checkpoint: CheckpointInfo = get_closet_checkpoint_match(model_hash)
    if not checkpoint:
        log.warn(f"[AgentScheduler] No checkpoint found for model hash {model_hash}")
        return
    args.override_settings["sd_model_checkpoint"] = checkpoint.title

    # load images from url or file if needed
    if is_img2img:
        init_images = args.init_images
        for i, image in enumerate(init_images):
            init_images[i] = load_image_to_base64(image)

        args.mask = load_image_to_base64(args.mask)

    # handle custom controlnet args
    if controlnet_args is not None:
        if args.alwayson_scripts is None:
            args.alwayson_scripts = {}

        controlnets = []
        for cnet in controlnet_args:
            enabled = cnet.get("enabled", True)
            cnet_image = cnet.get("image", None)

            if not enabled:
                continue
            if not isinstance(cnet_image, dict):
                log.error(f"[AgentScheduler] Controlnet image is required")
                continue

            image = cnet_image.get("image", None)
            mask = cnet_image.get("mask", None)
            if image is None:
                log.error(f"[AgentScheduler] Controlnet image is required")
                continue

            # load controlnet images from url or file if needed
            cnet_image["image"] = load_image_to_base64(image)
            cnet_image["mask"] = load_image_to_base64(mask)
            controlnets.append(cnet)

        if len(controlnets) > 0:
            args.alwayson_scripts["controlnet"] = {"args": controlnets}

    return args.dict()
