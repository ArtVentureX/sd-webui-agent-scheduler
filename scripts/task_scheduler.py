import os
import json
import platform
import gradio as gr
from PIL import Image
from gradio import context
from modules import shared, script_callbacks, scripts
from modules.shared import list_checkpoint_tiles, refresh_checkpoints
from modules.ui import create_refresh_button
from modules.generation_parameters_copypaste import (
    registered_param_bindings,
    create_buttons,
    register_paste_params_button,
    connect_paste_params_buttons,
    ParamBinding,
)

from agent_scheduler.task_runner import (
    TaskRunner,
    get_instance,
    task_history_retenion_map,
)
from agent_scheduler.helpers import (
    log,
    compare_components_with_ids,
    get_components_by_ids,
)
from agent_scheduler.db import init as init_db, task_manager, TaskStatus
from agent_scheduler.api import regsiter_apis

task_runner: TaskRunner = None

checkpoint_current = "Current Checkpoint"
checkpoint_runtime = "Runtime Checkpoint"

ui_placement_as_tab = "As a tab"
ui_placement_append_to_main = "Append to main UI"

placement_under_generate = "Under Generate button"
placement_between_prompt_and_generate = "Between Prompt and Generate button"

task_filter_choices = ["All", "Bookmarked", "Done", "Failed", "Interrupted"]

is_macos = platform.system() == "Darwin"
enqueue_key_modifiers = [
    "Command" if is_macos else "Ctrl",
    "Control" if is_macos else "Alt",
    "Shift",
]
enqueue_default_hotkey = enqueue_key_modifiers[0] + "+KeyE"
enqueue_key_codes = {}
enqueue_key_codes.update(
    {chr(i): "Key" + chr(i) for i in range(ord("A"), ord("Z") + 1)}
)
enqueue_key_codes.update(
    {chr(i): "Digit" + chr(i) for i in range(ord("0"), ord("9") + 1)}
)
enqueue_key_codes.update({"`": "Backquote", "Enter": "Enter"})

init_db()


class Script(scripts.Script):
    def __init__(self):
        super().__init__()
        script_callbacks.on_app_started(lambda block, _: self.on_app_started(block))
        self.checkpoint_override = checkpoint_current
        self.generate_button = None
        self.enqueue_row = None
        self.checkpoint_dropdown = None
        self.submit_button = None

    def title(self):
        return "Agent Scheduler"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def on_checkpoint_changed(self, checkpoint):
        self.checkpoint_override = checkpoint

    def after_component(self, component, **_kwargs):
        generate_id = "txt2img_generate" if self.is_txt2img else "img2img_generate"
        neg_id = "txt2img_neg_prompt" if self.is_txt2img else "img2img_neg_prompt"

        if component.elem_id == generate_id:
            self.generate_button = component
            if (
                getattr(shared.opts, "queue_button_placement", placement_under_generate)
                == placement_under_generate
            ):
                self.add_enqueue_button()
                component.parent.children.pop()
                component.parent.parent.add(self.enqueue_row)
            return

        if (
            component.elem_id == neg_id
            and getattr(shared.opts, "queue_button_placement", placement_under_generate)
            == placement_between_prompt_and_generate
        ):
            toprow = component.parent.parent.parent.parent.parent
            self.add_enqueue_button()
            component.parent.children.pop()
            toprow.add(self.enqueue_row)

    def on_app_started(self, block):
        if self.generate_button is not None:
            self.bind_enqueue_button(block)

    def add_enqueue_button(self):
        id_part = "img2img" if self.is_img2img else "txt2img"
        with gr.Row(elem_id=f"{id_part}_enqueue_wrapper") as row:
            self.enqueue_row = row
            if not getattr(shared.opts, "queue_button_hide_checkpoint", True):
                self.checkpoint_dropdown = gr.Dropdown(
                    choices=get_checkpoint_choices(),
                    value=checkpoint_current,
                    show_label=False,
                    interactive=True,
                )
                create_refresh_button(
                    self.checkpoint_dropdown,
                    refresh_checkpoints,
                    lambda: {"choices": get_checkpoint_choices()},
                    f"refresh_{id_part}_checkpoint",
                )
            self.submit_button = gr.Button(
                "Enqueue", elem_id=f"{id_part}_enqueue", variant="primary"
            )

    def bind_enqueue_button(self, root: gr.Blocks):
        generate = self.generate_button
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

        with root:
            if self.checkpoint_dropdown is not None:
                self.checkpoint_dropdown.change(
                    fn=self.on_checkpoint_changed, inputs=[self.checkpoint_dropdown]
                )

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
                outputs=None,
                show_progress=False,
            )

            self.submit_button.click(**args)

            if cnet_dependency is not None:
                cnet_fn_block = next(
                    fn
                    for fn in root.fns
                    if compare_components_with_ids(fn.inputs, cnet_dependency["inputs"])
                )
                self.submit_button.click(
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

        return f


def get_checkpoint_choices():
    choices = [checkpoint_current, checkpoint_runtime]
    choices.extend(list_checkpoint_tiles())
    return choices


def get_task_results(task_id: str, image_idx: int = None):
    task = task_manager.get_task(task_id)

    galerry = None
    infotexts = None
    if task is None:
        pass
    elif task.status != TaskStatus.DONE:
        infotexts = f"Status: {task.status}"
        if task.status == TaskStatus.FAILED and task.result:
            infotexts += f"\nError: {task.result}"
    elif task.status == TaskStatus.DONE:
        try:
            result: dict = json.loads(task.result)
            images = result.get("images", [])
            infos = result.get("infotexts", [])
            galerry = (
                [Image.open(i) for i in images if os.path.exists(i)]
                if image_idx is None
                else gr.update()
            )
            idx = image_idx if image_idx is not None else 0
            if len(infos) == len(images):
                infotexts = infos[idx]
            else:
                infotexts = "\n".join(infos).split("Prompt: ")[1:][idx]

        except Exception as e:
            log.error(f"[AgentScheduler] Failed to load task result")
            log.error(e)
            infotexts = f"Failed to load task result: {str(e)}"

    res = (
        gr.Textbox.update(infotexts, visible=infotexts is not None),
        gr.Row.update(visible=galerry is not None),
    )
    return res if image_idx is not None else (galerry,) + res


def on_ui_tab(**_kwargs):
    with gr.Blocks(analytics_enabled=False) as scheduler_tab:
        with gr.Tabs(elem_id="agent_scheduler_tabs"):
            with gr.Tab(
                "Task Queue", id=0, elem_id="agent_scheduler_pending_tasks_tab"
            ):
                with gr.Row(elem_id="agent_scheduler_pending_tasks_wrapper"):
                    with gr.Column(scale=1):
                        with gr.Group(elem_id="agent_scheduler_pending_tasks_actions"):
                            paused = getattr(shared.opts, "queue_paused", False)

                            gr.Button(
                                "Pause",
                                elem_id="agent_scheduler_action_pause",
                                variant="stop",
                                visible=not paused,
                            )
                            gr.Button(
                                "Resume",
                                elem_id="agent_scheduler_action_resume",
                                variant="primary",
                                visible=paused,
                            )
                            gr.Button(
                                "Refresh",
                                elem_id="agent_scheduler_action_reload",
                                variant="secondary",
                            )
                            gr.HTML('<div id="agent_scheduler_action_search"></div>')
                        gr.HTML(
                            '<div id="agent_scheduler_pending_tasks_grid" class="ag-theme-alpine"></div>'
                        )
                    with gr.Column(scale=1):
                        gr.Gallery(
                            elem_id="agent_scheduler_current_task_images",
                            label="Output",
                            show_label=False,
                        ).style(columns=2, object_fit="contain")
            with gr.Tab("Task History", id=1, elem_id="agent_scheduler_history_tab"):
                with gr.Row(elem_id="agent_scheduler_history_wrapper"):
                    with gr.Column(scale=1):
                        with gr.Group(elem_id="agent_scheduler_history_actions"):
                            gr.Button(
                                "Refresh",
                                elem_id="agent_scheduler_action_refresh_history",
                                elem_classes="agent_scheduler_action_refresh",
                                variant="secondary",
                            )
                            status = gr.Dropdown(
                                elem_id="agent_scheduler_status_filter",
                                choices=task_filter_choices,
                                value="All",
                                show_label=False,
                            )
                            gr.HTML(
                                '<div id="agent_scheduler_action_search_history"></div>'
                            )
                        gr.HTML(
                            '<div id="agent_scheduler_history_tasks_grid" class="ag-theme-alpine"></div>'
                        )
                    with gr.Column(scale=1, elem_id="agent_scheduler_history_results"):
                        galerry = gr.Gallery(
                            elem_id="agent_scheduler_history_gallery",
                            label="Output",
                            show_label=False,
                        ).style(columns=2, object_fit="contain", preview=True)
                        gen_info = gr.TextArea(
                            label="Generation Info",
                            elem_id=f"agent_scheduler_history_gen_info",
                            interactive=False,
                            visible=True,
                            lines=3,
                        )
                        with gr.Row(
                            elem_id="agent_scheduler_history_result_actions",
                            visible=False,
                        ) as result_actions:
                            try:
                                send_to_buttons = create_buttons(
                                    ["txt2img", "img2img", "inpaint", "extras"]
                                )
                            except:
                                pass
                        selected_task = gr.Textbox(
                            elem_id="agent_scheduler_history_selected_task",
                            visible=False,
                            show_label=False,
                        )
                        selected_task_id = gr.Textbox(
                            elem_id="agent_scheduler_history_selected_image",
                            visible=False,
                            show_label=False,
                        )

        # register event handlers
        status.change(
            fn=lambda x: None,
            _js="agent_scheduler_status_filter_changed",
            inputs=[status],
        )
        selected_task.change(
            fn=get_task_results,
            inputs=[selected_task],
            outputs=[galerry, gen_info, result_actions],
        )
        selected_task_id.change(
            fn=lambda x, y: get_task_results(x, image_idx=int(y)),
            inputs=[selected_task, selected_task_id],
            outputs=[gen_info, result_actions],
        )
        try:
            for paste_tabname, paste_button in send_to_buttons.items():
                register_paste_params_button(
                    ParamBinding(
                        paste_button=paste_button,
                        tabname=paste_tabname,
                        source_text_component=gen_info,
                        source_image_component=galerry,
                    )
                )
        except:
            pass

    return [(scheduler_tab, "Agent Scheduler", "agent_scheduler")]


def on_ui_settings():
    section = ("agent_scheduler", "Agent Scheduler")
    shared.opts.add_option(
        "queue_paused",
        shared.OptionInfo(
            False,
            "Disable queue auto-processing",
            gr.Checkbox,
            {"interactive": True},
            section=section,
        ),
    )
    shared.opts.add_option(
        "queue_button_placement",
        shared.OptionInfo(
            placement_under_generate,
            "Queue button placement",
            gr.Radio,
            lambda: {
                "choices": [
                    placement_under_generate,
                    placement_between_prompt_and_generate,
                ]
            },
            section=section,
        ),
    )
    shared.opts.add_option(
        "queue_button_hide_checkpoint",
        shared.OptionInfo(
            True,
            "Hide the checkpoint dropdown",
            gr.Checkbox,
            {},
            section=section,
        ),
    )
    shared.opts.add_option(
        "queue_history_retention_days",
        shared.OptionInfo(
            "30 days",
            "Auto delete queue history (bookmarked tasks excluded)",
            gr.Radio,
            lambda: {
                "choices": list(task_history_retenion_map.keys()),
            },
            section=section,
        ),
    )

    def enqueue_keyboard_shortcut(disabled: bool, modifiers: list[str], key_code: str):
        if disabled:
            modifiers.insert(0, "Disabled")

        shortcut = "+".join(sorted(modifiers) + [enqueue_key_codes[key_code]])

        return (
            shortcut,
            gr.CheckboxGroup.update(interactive=not disabled),
            gr.Dropdown.update(interactive=not disabled),
        )

    def enqueue_keyboard_shortcut_ui(**_kwargs):
        value = _kwargs.get("value", enqueue_default_hotkey)
        parts = value.split("+")
        key = parts.pop()
        key_code_value = [k for k, v in enqueue_key_codes.items() if v == key]
        modifiers = [m for m in parts if m in enqueue_key_modifiers]
        disabled = "Disabled" in value

        with gr.Group(elem_id="enqueue_keyboard_shortcut_wrapper"):
            modifiers = gr.CheckboxGroup(
                enqueue_key_modifiers,
                value=modifiers,
                label="Enqueue keyboard shortcut",
                elem_id="enqueue_keyboard_shortcut_modifiers",
                interactive=not disabled,
            )
            key_code = gr.Dropdown(
                choices=list(enqueue_key_codes.keys()),
                value="E" if len(key_code_value) == 0 else key_code_value[0],
                elem_id="enqueue_keyboard_shortcut_key",
                label="Key",
                interactive=not disabled,
            )
            shortcut = gr.Textbox(**_kwargs)
            disable = gr.Checkbox(
                value=disabled,
                label="Disable keyboard shortcut",
                elem_id="enqueue_keyboard_shortcut_disable",
            )

        modifiers.change(
            fn=enqueue_keyboard_shortcut,
            inputs=[disable, modifiers, key_code],
            outputs=[shortcut, modifiers, key_code],
        )
        key_code.change(
            fn=enqueue_keyboard_shortcut,
            inputs=[disable, modifiers, key_code],
            outputs=[shortcut, modifiers, key_code],
        )
        disable.change(
            fn=enqueue_keyboard_shortcut,
            inputs=[disable, modifiers, key_code],
            outputs=[shortcut, modifiers, key_code],
        )

        return shortcut

    shared.opts.add_option(
        "queue_keyboard_shortcut",
        shared.OptionInfo(
            enqueue_default_hotkey,
            "Enqueue keyboard shortcut",
            enqueue_keyboard_shortcut_ui,
            {
                "interactive": False,
            },
            section=section,
        ),
    )

    shared.opts.add_option(
        "queue_ui_placement",
        shared.OptionInfo(
            ui_placement_as_tab,
            "Task queue UI placement",
            gr.Radio,
            lambda: {
                "choices": [
                    ui_placement_as_tab,
                    ui_placement_append_to_main,
                ]
            },
            section=section,
        ),
    )


def on_app_started(block: gr.Blocks, app):
    global task_runner
    task_runner = get_instance(block)
    task_runner.execute_pending_tasks_threading()
    regsiter_apis(app, task_runner)

    if (
        getattr(shared.opts, "queue_ui_placement", "") == ui_placement_append_to_main
        and block
    ):
        with block:
            with block.children[1]:
                bindings = registered_param_bindings.copy()
                registered_param_bindings.clear()
                on_ui_tab()
                connect_paste_params_buttons()
                registered_param_bindings.extend(bindings)


if getattr(shared.opts, "queue_ui_placement", "") != ui_placement_append_to_main:
    script_callbacks.on_ui_tabs(on_ui_tab)

script_callbacks.on_ui_settings(on_ui_settings)
script_callbacks.on_app_started(on_app_started)
