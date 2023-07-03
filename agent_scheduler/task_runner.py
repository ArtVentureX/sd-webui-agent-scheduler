import os
import json
import time
import traceback
import threading

from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Any, Callable, Union, Optional
from fastapi import FastAPI
from PIL import Image

from modules import progress, shared, script_callbacks
from modules.call_queue import queue_lock, wrap_gradio_call
from modules.txt2img import txt2img
from modules.img2img import img2img
from modules.api.api import Api
from modules.api.models import (
    StableDiffusionTxt2ImgProcessingAPI,
    StableDiffusionImg2ImgProcessingAPI,
)

from .db import TaskStatus, Task, task_manager
from .helpers import (
    log,
    detect_control_net,
    get_component_by_elem_id,
    get_dict_attribute,
)
from .task_helpers import (
    serialize_image,
    deserialize_image,
    encode_image_to_base64,
    serialize_img2img_image_args,
    deserialize_img2img_image_args,
    serialize_controlnet_args,
    deserialize_controlnet_args,
    serialize_api_task_args,
    map_ui_task_args_list_to_named_args,
    map_named_args_to_ui_task_args_list,
)


class OutOfMemoryError(Exception):
    def __init__(self, message="CUDA out of memory") -> None:
        self.message = message
        super().__init__(message)


task_history_retenion_map = {
    "7 days": 7,
    "14 days": 14,
    "30 days": 30,
    "90 days": 90,
    "Keep forever": 0,
}


class ParsedTaskArgs(BaseModel):
    is_ui: bool
    ui_args: list[Any]
    named_args: dict[str, Any]
    script_args: list[Any]
    checkpoint: Optional[str] = None


class TaskRunner:
    instance = None

    def __init__(self, UiControlNetUnit=None):
        self.UiControlNetUnit = UiControlNetUnit

        self.__total_pending_tasks: int = 0
        self.__current_thread: threading.Thread = None
        self.__api = Api(FastAPI(), queue_lock)

        self.__saved_images_path: list[tuple[str, str]] = []
        script_callbacks.on_image_saved(self.__on_image_saved)

        self.script_callbacks = {
            "task_registered": [],
            "task_started": [],
            "task_finished": [],
            "task_cleared": [],
        }

        # Mark this to True when reload UI
        self.dispose = False
        self.interrupted = None

        if TaskRunner.instance is not None:
            raise Exception("TaskRunner instance already exists")
        TaskRunner.instance = self

    @property
    def current_task_id(self) -> Union[str, None]:
        return progress.current_task

    @property
    def is_executing_task(self) -> bool:
        return self.__current_thread and self.__current_thread.is_alive()

    @property
    def paused(self) -> bool:
        return getattr(shared.opts, "queue_paused", False)

    def __serialize_ui_task_args(self, is_img2img: bool, *args, checkpoint: str = None):
        named_args, script_args = map_ui_task_args_list_to_named_args(
            list(args), is_img2img, checkpoint=checkpoint
        )

        # loop through named_args and serialize images
        if is_img2img:
            serialize_img2img_image_args(named_args)

        # loop through script_args and serialize images
        for i, a in enumerate(script_args):
            if isinstance(a, Image.Image):
                script_args[i] = serialize_image(a)
            elif self.UiControlNetUnit and isinstance(a, self.UiControlNetUnit):
                script_args[i] = serialize_controlnet_args(a)

        return json.dumps(
            {
                "args": named_args,
                "script_args": script_args,
                "checkpoint": checkpoint,
                "is_ui": True,
                "is_img2img": is_img2img,
            }
        )

    def __serialize_api_task_args(
        self,
        is_img2img: bool,
        script_args: list = [],
        checkpoint: str = None,
        **api_args,
    ):
        named_args = serialize_api_task_args(
            api_args, is_img2img, checkpoint=checkpoint
        )
        checkpoint = get_dict_attribute(
            named_args, "override_settings.sd_model_checkpoint", None
        )

        return json.dumps(
            {
                "args": named_args,
                "script_args": script_args,
                "checkpoint": checkpoint,
                "is_ui": False,
                "is_img2img": is_img2img,
            }
        )

    def __deserialize_ui_task_args(
        self, is_img2img: bool, named_args: dict, script_args: list
    ):
        # loop through image_args and deserialize images
        if is_img2img:
            deserialize_img2img_image_args(named_args)

        # loop through script_args and deserialize images
        for i, arg in enumerate(script_args):
            if isinstance(arg, dict) and arg.get("is_cnet", False):
                script_args[i] = deserialize_controlnet_args(arg)
            elif isinstance(arg, dict) and arg.get("cls", "") in {"Image", "ndarray"}:
                script_args[i] = deserialize_image(arg)

    def __deserialize_api_task_args(self, is_img2img: bool, named_args: dict):
        # load images from disk
        if is_img2img:
            init_images = named_args.get("init_images")
            for i, img in enumerate(init_images):
                if isinstance(img, str) and os.path.isfile(img):
                    image = Image.open(img)
                    init_images[i] = encode_image_to_base64(image)

        named_args.update({"save_images": True, "send_images": False})

    def parse_task_args(self, task: Task, deserialization: bool = True):
        parsed: dict[str, Any] = json.loads(task.params)

        is_ui = parsed.get("is_ui", True)
        is_img2img = parsed.get("is_img2img", None)
        checkpoint = parsed.get("checkpoint", None)
        named_args: dict[str, Any] = parsed["args"]
        script_args: list[Any] = parsed.get("script_args", [])

        if is_ui and deserialization:
            self.__deserialize_ui_task_args(is_img2img, named_args, script_args)
        elif deserialization:
            self.__deserialize_api_task_args(is_img2img, named_args)

        ui_args = (
            map_named_args_to_ui_task_args_list(named_args, script_args, is_img2img)
            if is_ui
            else []
        )

        return ParsedTaskArgs(
            is_ui=is_ui,
            ui_args=ui_args,
            named_args=named_args,
            script_args=script_args,
            checkpoint=checkpoint,
        )

    def register_ui_task(
        self, task_id: str, is_img2img: bool, *args, checkpoint: str = None
    ):
        progress.add_task_to_queue(task_id)

        params = self.__serialize_ui_task_args(is_img2img, *args, checkpoint=checkpoint)

        task_type = "img2img" if is_img2img else "txt2img"
        task_manager.add_task(Task(id=task_id, type=task_type, params=params))

        self.__run_callbacks(
            "task_registered", task_id, is_img2img=is_img2img, is_ui=True, args=params
        )
        self.__total_pending_tasks += 1

    def register_api_task(
        self,
        task_id: str,
        api_task_id: str,
        is_img2img: bool,
        args: dict,
        checkpoint: str = None,
    ):
        progress.add_task_to_queue(task_id)

        params = self.__serialize_api_task_args(
            is_img2img, checkpoint=checkpoint, **args
        )

        task_type = "img2img" if is_img2img else "txt2img"
        task_manager.add_task(
            Task(id=task_id, api_task_id=api_task_id, type=task_type, params=params)
        )

        self.__run_callbacks(
            "task_registered", task_id, is_img2img=is_img2img, is_ui=False, args=params
        )
        self.__total_pending_tasks += 1

    def execute_task(self, task: Task, get_next_task: Callable[[], Task]):
        while True:
            if self.dispose:
                break

            if progress.current_task is None:
                task_id = task.id
                is_img2img = task.type == "img2img"
                log.info(f"[AgentScheduler] Executing task {task_id}")

                task_args = self.parse_task_args(task)
                task_meta = {
                    "is_img2img": is_img2img,
                    "is_ui": task_args.is_ui,
                    "api_task_id": task.api_task_id,
                }

                self.interrupted = None
                self.__saved_images_path = []
                self.__run_callbacks("task_started", task_id, **task_meta)

                # enable image saving
                samples_save = shared.opts.samples_save
                shared.opts.samples_save = True

                res = self.__execute_task(task_id, is_img2img, task_args)

                # disable image saving
                shared.opts.samples_save = samples_save

                if not res or isinstance(res, Exception):
                    if isinstance(res, OutOfMemoryError):
                        log.error(
                            f"[AgentScheduler] Task {task_id} failed: CUDA OOM. Queue will be paused."
                        )
                        shared.opts.queue_paused = True
                    else:
                        log.error(f"[AgentScheduler] Task {task_id} failed: {res}")
                        log.debug(traceback.format_exc())

                    task_manager.update_task(
                        id=task_id,
                        status=TaskStatus.FAILED,
                        result=str(res) if res else None,
                    )
                    self.__run_callbacks(
                        "task_finished", task_id, status=TaskStatus.FAILED, **task_meta
                    )
                else:
                    is_interrupted = self.interrupted == task_id
                    if is_interrupted:
                        log.info(f"\n[AgentScheduler] Task {task.id} interrupted")
                        task_manager.update_task(
                            id=task_id,
                            status=TaskStatus.INTERRUPTED,
                        )
                        self.__run_callbacks(
                            "task_finished",
                            task_id,
                            status=TaskStatus.INTERRUPTED,
                            **task_meta,
                        )
                    else:
                        result = {
                            "images": [],
                            "infotexts": [],
                        }
                        for filename, pnginfo in self.__saved_images_path:
                            result["images"].append(filename)
                            result["infotexts"].append(pnginfo)

                        task_manager.update_task(
                            id=task_id,
                            status=TaskStatus.DONE,
                            result=json.dumps(result),
                        )
                        self.__run_callbacks(
                            "task_finished",
                            task_id,
                            status=TaskStatus.DONE,
                            result=result,
                            **task_meta,
                        )

                self.__saved_images_path = []
            else:
                time.sleep(2)
                continue

            task = get_next_task()
            if not task:
                break

    def execute_pending_tasks_threading(self):
        if self.paused:
            log.info("[AgentScheduler] Runner is paused")
            return

        if self.is_executing_task:
            log.info("[AgentScheduler] Runner already started")
            return

        pending_task = self.__get_pending_task()
        if pending_task:
            # Start the infinite loop in a separate thread
            self.__current_thread = threading.Thread(
                target=self.execute_task,
                args=(
                    pending_task,
                    self.__get_pending_task,
                ),
            )
            self.__current_thread.daemon = True
            self.__current_thread.start()

    def __execute_task(self, task_id: str, is_img2img: bool, task_args: ParsedTaskArgs):
        if task_args.is_ui:
            return self.__execute_ui_task(task_id, is_img2img, *task_args.ui_args)
        else:
            return self.__execute_api_task(
                task_id,
                is_img2img,
                **task_args.named_args,
            )

    def __execute_ui_task(self, task_id: str, is_img2img: bool, *args):
        func = wrap_gradio_call(img2img if is_img2img else txt2img, add_stats=True)

        with queue_lock:
            shared.state.begin()
            progress.start_task(task_id)

            res = None
            try:
                result = func(*args)
                if (
                    result[0] is None
                    and hasattr(shared.state, "oom")
                    and shared.state.oom
                ):
                    res = OutOfMemoryError()
                elif "CUDA out of memory" in result[2]:
                    res = OutOfMemoryError()
                else:
                    res = result[1]
            except Exception as e:
                res = e
            finally:
                progress.finish_task(task_id)

            shared.state.end()

            return res

    def __execute_api_task(self, task_id: str, is_img2img: bool, **kwargs):
        progress.start_task(task_id)

        res = None
        try:
            result = (
                self.__api.img2imgapi(StableDiffusionImg2ImgProcessingAPI(**kwargs))
                if is_img2img
                else self.__api.text2imgapi(
                    StableDiffusionTxt2ImgProcessingAPI(**kwargs)
                )
            )
            res = result.info
        except Exception as e:
            if "CUDA out of memory" in str(e):
                res = OutOfMemoryError()
            else:
                res = e
        finally:
            progress.finish_task(task_id)

        return res

    def __get_pending_task(self):
        if self.dispose:
            return None

        if self.paused:
            log.info("[AgentScheduler] Runner is paused")
            return None

        # delete task that are too old
        retention_days = 30
        if (
            getattr(shared.opts, "queue_history_retention_days", None)
            and shared.opts.queue_history_retention_days in task_history_retenion_map
        ):
            retention_days = task_history_retenion_map[
                shared.opts.queue_history_retention_days
            ]

        if retention_days > 0:
            deleted_rows = task_manager.delete_tasks_before(
                datetime.now() - timedelta(days=retention_days)
            )
            if deleted_rows > 0:
                log.debug(
                    f"[AgentScheduler] Deleted {deleted_rows} tasks older than {retention_days} days"
                )

        self.__total_pending_tasks = task_manager.count_tasks(status="pending")

        # get more task if needed
        if self.__total_pending_tasks > 0:
            log.info(
                f"[AgentScheduler] Total pending tasks: {self.__total_pending_tasks}"
            )
            pending_tasks = task_manager.get_tasks(status="pending", limit=1)
            if len(pending_tasks) > 0:
                return pending_tasks[0]
        else:
            log.info("[AgentScheduler] Task queue is empty")
            self.__run_callbacks("task_cleared")

    def __on_image_saved(self, data: script_callbacks.ImageSaveParams):
        self.__saved_images_path.append(
            (data.filename, data.pnginfo.get("parameters", ""))
        )

    def on_task_registered(self, callback: Callable):
        """Callback when a task is registered

        Callback signature: callback(task_id: str, is_img2img: bool, is_ui: bool, args: dict)
        """

        self.script_callbacks["task_registered"].append(callback)

    def on_task_started(self, callback: Callable):
        """Callback when a task is started

        Callback signature: callback(task_id: str, is_img2img: bool, is_ui: bool)
        """

        self.script_callbacks["task_started"].append(callback)

    def on_task_finished(self, callback: Callable):
        """Callback when a task is finished

        Callback signature: callback(task_id: str, is_img2img: bool, is_ui: bool, status: TaskStatus, result: dict)
        """

        self.script_callbacks["task_finished"].append(callback)

    def on_task_cleared(self, callback: Callable):
        self.script_callbacks["task_cleared"].append(callback)

    def __run_callbacks(self, name: str, *args, **kwargs):
        for callback in self.script_callbacks[name]:
            callback(*args, **kwargs)


def get_instance(block) -> TaskRunner:
    if TaskRunner.instance is None:
        if block is not None:
            txt2img_submit_button = get_component_by_elem_id(block, "txt2img_generate")
            UiControlNetUnit = detect_control_net(block, txt2img_submit_button)
            TaskRunner(UiControlNetUnit)
        else:
            TaskRunner()

        def on_before_reload():
            # Tell old instance to stop
            TaskRunner.instance.dispose = True
            # force recreate the instance
            TaskRunner.instance = None

        script_callbacks.on_before_reload(on_before_reload)

    return TaskRunner.instance
