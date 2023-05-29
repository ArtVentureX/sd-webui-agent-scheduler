import gradio as gr

from modules import shared, script_callbacks, scripts
from modules.shared import list_checkpoint_tiles, refresh_checkpoints
from modules.ui import create_refresh_button

from scripts.task_runner import TaskRunner, get_instance
from scripts.helpers import compare_components_with_ids, get_components_by_ids
from scripts.db import init, state_manager, AppStateKey

task_runner: TaskRunner = None
initialized = False

checkpoint_current = "Current Checkpoint"
checkpoint_runtime = "Runtime Checkpoint"


class Script(scripts.Script):
    def __init__(self):
        super().__init__()
        script_callbacks.on_app_started(lambda block, _: self.on_app_started(block))
        self.checkpoint_override = checkpoint_current

    def title(self):
        return "Agent Scheduler"

    def show(self, is_img2img):
        return True

    def on_checkpoint_changed(self, checkpoint):
        self.checkpoint_override = checkpoint

    def after_component(self, component, **_kwargs):
        elem_id = "txt2img_generate" if self.is_txt2img else "img2img_generate"

        if component.elem_id == elem_id:
            self.generate_button = component

    def on_app_started(self, block):
        self.add_enqueue_button(block, self.generate_button)

    def add_enqueue_button(self, root: gr.Blocks, generate: gr.Button):
        is_img2img = self.is_img2img
        dependencies: list[dict] = [
            x
            for x in root.dependencies
            if x["trigger"] == "click" and generate._id in x["targets"]
        ]

        dependency: dict = None
        cnet_dependency: dict = None
        UiControlNetUnit = None
        for d in dependencies:
            if len(d["outputs"]) == 1:
                outputs = get_components_by_ids(root, d["outputs"])
                output = outputs[0]
                if (
                    isinstance(output, gr.State)
                    and type(output.value).__name__ == "UiControlNetUnit"
                ):
                    cnet_dependency = d
                    UiControlNetUnit = type(output.value)

            elif len(d["outputs"]) == 4:
                dependency = d

        fn_block = next(
            fn
            for fn in root.fns
            if compare_components_with_ids(fn.inputs, dependency["inputs"])
        )
        fn = self.wrap_register_ui_task()
        args = dict(
            fn=fn,
            _js="submit_enqueue_img2img" if is_img2img else "submit_enqueue",
            inputs=fn_block.inputs,
            outputs=fn_block.outputs,
            show_progress=False,
        )
        with root:
            with generate.parent:
                id_part = "img2img" if is_img2img else "txt2img"
                with gr.Row(elem_id=f"{id_part}_enqueue_wrapper"):
                    checkpoint = gr.Dropdown(
                        choices=get_checkpoint_choices(),
                        value=checkpoint_current,
                        show_label=False,
                        interactive=True,
                    )
                    create_refresh_button(
                        checkpoint,
                        refresh_checkpoints,
                        lambda: {"choices": get_checkpoint_choices()},
                        f"refresh_{id_part}_checkpoint",
                    )
                    submit = gr.Button(
                        "Enqueue", elem_id=f"{id_part}_enqueue", variant="primary"
                    )

                checkpoint.change(fn=self.on_checkpoint_changed, inputs=[checkpoint])
                submit.click(**args)

        if cnet_dependency is not None:
            cnet_fn_block = next(
                fn
                for fn in root.fns
                if compare_components_with_ids(fn.inputs, cnet_dependency["inputs"])
            )
            with root:
                submit.click(
                    fn=UiControlNetUnit,
                    inputs=cnet_fn_block.inputs,
                    outputs=cnet_fn_block.outputs,
                    queue=False,
                )

    def wrap_register_ui_task(self):
        def f(*args, **kwargs):
            if len(args) == 0 and len(kwargs) == 0:
                raise Exception("Invalid call")

            if len(args) > 0 and type(args[0]) == str:
                task_id = args[0]
            else:
                # not a task, exit
                return (None, "", "<p>Invalid params</p>", "")

            checkpoint = None
            if self.checkpoint_override == checkpoint_current:
                checkpoint = shared.sd_model.sd_checkpoint_info.title
            elif self.checkpoint_override != checkpoint_runtime:
                checkpoint = self.checkpoint_override

            task_runner.register_ui_task(
                task_id, self.is_img2img, *args, checkpoint=checkpoint
            )
            task_runner.execute_pending_tasks_threading()

            return (None, "", "<p>Task queued</p>", "")

        return f


def get_checkpoint_choices():
    choices = [checkpoint_current, checkpoint_runtime]
    choices.extend(list_checkpoint_tiles())
    return choices


def is_queue_paused():
    return state_manager.get_value(AppStateKey.QueueState) == "paused"


def on_ui_tab(**_kwargs):
    global initialized
    if not initialized:
        initialized = True
        init()

    with gr.Blocks(analytics_enabled=False) as scheduler_tab:
        with gr.Row(elem_id="agent_scheduler_pending_tasks_wrapper"):
            with gr.Column(scale=1):
                with gr.Group(elem_id="agent_scheduler_actions"):
                    paused = is_queue_paused()

                    pause = gr.Button(
                        "Pause",
                        elem_id="agent_scheduler_action_pause",
                        variant="stop",
                        visible=not paused,
                    )
                    resume = gr.Button(
                        "Resume",
                        elem_id="agent_scheduler_action_resume",
                        variant="primary",
                        visible=paused,
                    )
                    gr.Button(
                        "Refresh",
                        elem_id="agent_scheduler_action_refresh",
                        variant="secondary",
                    )
                    gr.HTML('<div id="agent_scheduler_action_search"></div>')
                gr.HTML(
                    '<div id="agent_scheduler_pending_tasks_grid" class="ag-theme-alpine"></div>'
                )
            with gr.Column(scale=1):
                with gr.Group(elem_id="agent_scheduler_current_task_progress"):
                    gr.Gallery(
                        elem_id="agent_scheduler_current_task_images",
                        label="Output",
                        show_label=False,
                    ).style(grid=4)

    return [(scheduler_tab, "Agent Scheduler", "agent_scheduler")]


def on_app_started(block, _):
    global task_runner
    task_runner = get_instance(block)
    task_runner.execute_pending_tasks_threading()


script_callbacks.on_ui_tabs(on_ui_tab)
script_callbacks.on_app_started(on_app_started)
