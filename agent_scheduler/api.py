import threading
from uuid import uuid4
from gradio.routes import App

from modules import shared, progress

from .db import TaskStatus, task_manager
from .models import (
    Txt2ImgApiTaskArgs,
    Img2ImgApiTaskArgs,
    QueueTaskResponse,
    QueueStatusResponse,
    HistoryResponse,
    TaskModel,
)
from .task_runner import TaskRunner
from .helpers import log
from .task_helpers import serialize_api_task_args


def regsiter_apis(app: App, task_runner: TaskRunner):
    log.info("[AgentScheduler] Registering APIs")

    @app.post("/agent-scheduler/v1/queue/txt2img", response_model=QueueTaskResponse)
    def queue_txt2img(body: Txt2ImgApiTaskArgs):
        params = body.dict()
        task_id = str(uuid4())
        checkpoint = params.pop("model_hash", None)
        task_args = serialize_api_task_args(
            params,
            is_img2img=False,
            checkpoint=checkpoint,
        )
        task_runner.register_api_task(
            task_id, api_task_id=False, is_img2img=False, args=task_args
        )
        task_runner.execute_pending_tasks_threading()

        return QueueTaskResponse(task_id=task_id)

    @app.post("/agent-scheduler/v1/queue/img2img", response_model=QueueTaskResponse)
    def queue_img2img(body: Img2ImgApiTaskArgs):
        params = body.dict()
        task_id = str(uuid4())
        checkpoint = params.pop("model_hash", None)
        task_args = serialize_api_task_args(
            params,
            is_img2img=True,
            checkpoint=checkpoint,
        )
        task_runner.register_api_task(
            task_id, api_task_id=False, is_img2img=True, args=task_args
        )
        task_runner.execute_pending_tasks_threading()

        return QueueTaskResponse(task_id=task_id)

    @app.get("/agent-scheduler/v1/queue", response_model=QueueStatusResponse)
    def queue_status_api(limit: int = 20, offset: int = 0):
        current_task_id = progress.current_task
        total_pending_tasks = task_manager.count_tasks(status="pending")
        pending_tasks = task_manager.get_tasks(
            status=TaskStatus.PENDING, limit=limit, offset=offset
        )
        parsed_tasks = []
        for task in pending_tasks:
            task_args = TaskRunner.instance.parse_task_args(
                task.params, task.script_params, deserialization=False
            )
            named_args = task_args.named_args
            named_args["checkpoint"] = task_args.checkpoint

            task_data = task.dict()
            task_data["params"] = named_args
            if task.id == current_task_id:
                task_data["status"] = "running"

            parsed_tasks.append(TaskModel(**task_data))

        return QueueStatusResponse(
            current_task_id=current_task_id,
            pending_tasks=parsed_tasks,
            total_pending_tasks=total_pending_tasks,
            paused=TaskRunner.instance.paused,
        )

    @app.get("/agent-scheduler/v1/history", response_model=HistoryResponse)
    def history_api(status: str = None, limit: int = 20, offset: int = 0):
        bookmarked = True if status == "bookmarked" else None
        if not status or status == "all" or bookmarked:
            status = [
                TaskStatus.DONE,
                TaskStatus.FAILED,
                TaskStatus.INTERRUPTED,
            ]

        total = task_manager.count_tasks(status=status)
        tasks = task_manager.get_tasks(
            status=status,
            bookmarked=bookmarked,
            limit=limit,
            offset=offset,
            order="desc",
        )
        parsed_tasks = []
        for task in tasks:
            task_args = TaskRunner.instance.parse_task_args(
                task.params, task.script_params, deserialization=False
            )
            named_args = task_args.named_args
            named_args["checkpoint"] = task_args.checkpoint

            task_data = task.dict()
            task_data["params"] = named_args
            parsed_tasks.append(TaskModel(**task_data))

        return HistoryResponse(
            total=total,
            tasks=parsed_tasks,
        )

    @app.post("/agent-scheduler/v1/run/{id}")
    def run_task(id: str):
        if progress.current_task is not None:
            if progress.current_task == id:
                return {"success": False, "message": f"Task {id} is already running"}
            else:
                # move task up in queue
                task_manager.prioritize_task(id, 0)
                return {
                    "success": True,
                    "message": f"Task {id} is scheduled to run next",
                }
        else:
            # run task
            task = task_manager.get_task(id)
            current_thread = threading.Thread(
                target=TaskRunner.instance.execute_task,
                args=(
                    task,
                    lambda: None,
                ),
            )
            current_thread.daemon = True
            current_thread.start()

            return {"success": True, "message": f"Task {id} is executing"}

    @app.post("/agent-scheduler/v1/requeue/{id}")
    def requeue_task(id: str):
        task = task_manager.get_task(id)
        if task is None:
            return {"success": False, "message": f"Task {id} not found"}

        task.id = str(uuid4())
        task.result = None
        task.status = TaskStatus.PENDING
        task.bookmarked = False
        task.name = f"Copy of {task.name}" if task.name else None
        task_manager.add_task(task)
        task_runner.execute_pending_tasks_threading()

        return {"success": True, "message": f"Task {id} is requeued"}

    @app.post("/agent-scheduler/v1/delete/{id}")
    def delete_task(id: str):
        if progress.current_task == id:
            shared.state.interrupt()
            task_runner.interrupted = id
            return {"success": True, "message": f"Task {id} is interrupted"}

        task_manager.delete_task(id)
        return {"success": True, "message": f"Task {id} is deleted"}

    @app.post("/agent-scheduler/v1/move/{id}/{over_id}")
    def move_task(id: str, over_id: str):
        task = task_manager.get_task(id)
        if task is None:
            return {"success": False, "message": f"Task {id} not found"}

        if over_id == "top":
            task_manager.prioritize_task(id, 0)
            return {"success": True, "message": f"Task {id} is moved to top"}
        elif over_id == "bottom":
            task_manager.prioritize_task(id, -1)
            return {"success": True, "message": f"Task {id} is moved to bottom"}
        else:
            over_task = task_manager.get_task(over_id)
            if over_task is None:
                return {"success": False, "message": f"Task {over_id} not found"}

            task_manager.prioritize_task(id, over_task.priority)
            return {"success": True, "message": f"Task {id} is moved"}

    @app.post("/agent-scheduler/v1/bookmark/{id}")
    def pin_task(id: str):
        task = task_manager.get_task(id)
        if task is None:
            return {"success": False, "message": f"Task {id} not found"}

        task.bookmarked = True
        task_manager.update_task(id, bookmarked=True)
        return {"success": True, "message": f"Task {id} is bookmarked"}

    @app.post("/agent-scheduler/v1/unbookmark/{id}")
    def unpin_task(id: str):
        task = task_manager.get_task(id)
        if task is None:
            return {"success": False, "message": f"Task {id} not found"}

        task_manager.update_task(id, bookmarked=False)
        return {"success": True, "message": f"Task {id} is unbookmarked"}

    @app.post("/agent-scheduler/v1/rename/{id}")
    def rename_task(id: str, name: str):
        task = task_manager.get_task(id)
        if task is None:
            return {"success": False, "message": f"Task {id} not found"}

        task_manager.update_task(id, name=name)
        return {"success": True, "message": f"Task {id} is renamed"}

    @app.post("/agent-scheduler/v1/pause")
    def pause_queue():
        shared.opts.queue_paused = True
        return {"success": True, "message": f"Queue is paused"}

    @app.post("/agent-scheduler/v1/resume")
    def resume_queue():
        shared.opts.queue_paused = False
        TaskRunner.instance.execute_pending_tasks_threading()
        return {"success": True, "message": f"Queue is resumed"}
