import json
import threading
from gradio.routes import App

import modules.shared as shared
from modules import progress, script_callbacks, sd_samplers

from scripts.db import TaskStatus, task_manager
from scripts.models import QueueStatusResponse
from scripts.task_runner import TaskRunner, get_instance
from scripts.helpers import log

task_runner: TaskRunner = None


def regsiter_apis(app: App):
    log.info("[AgentScheduler] Registering APIs")

    @app.get("/agent-scheduler/v1/queue", response_model=QueueStatusResponse)
    def queue_status_api(limit: int = 20, offset: int = 0):
        current_task_id = progress.current_task
        total_pending_tasks = total_pending_tasks = task_manager.count_tasks(
            status="pending"
        )
        pending_tasks = task_manager.get_tasks(
            status=TaskStatus.PENDING, limit=limit, offset=offset
        )
        for task in pending_tasks:
            task_args = TaskRunner.instance.parse_task_args(
                task.params, task.script_params, deserialization=False
            )
            named_args = task_args.named_args
            named_args["checkpoint"] = task_args.checkpoint
            sampler_index = named_args.get("sampler_index", None)
            if sampler_index is not None:
                named_args["sampler_name"] = sd_samplers.samplers[
                    named_args["sampler_index"]
                ].name
            task.params = json.dumps(named_args)

        return QueueStatusResponse(
            current_task_id=current_task_id,
            pending_tasks=pending_tasks,
            total_pending_tasks=total_pending_tasks,
            paused=TaskRunner.instance.paused,
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

    @app.post("/agent-scheduler/v1/delete/{id}")
    def delete_task(id: str):
        if progress.current_task == id:
            shared.state.interrupt()
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

    @app.post("/agent-scheduler/v1/pause")
    def pause_queue():
        # state_manager.set_value(AppStateKey.QueueState, "paused")
        shared.opts.queue_paused = True
        return {"success": True, "message": f"Queue is paused"}

    @app.post("/agent-scheduler/v1/resume")
    def resume_queue():
        # state_manager.set_value(AppStateKey.QueueState, "running")
        shared.opts.queue_paused = False
        TaskRunner.instance.execute_pending_tasks_threading()
        return {"success": True, "message": f"Queue is resumed"}


def on_app_started(block, app: App):
    if block is not None:
        global task_runner
        task_runner = get_instance(block)

        regsiter_apis(app)


script_callbacks.on_app_started(on_app_started)
