import abc
import logging

import gradio as gr
from gradio.blocks import Block, BlockContext

if not logging.getLogger().hasHandlers():
    # Logging is not set up
    logging.basicConfig(level=logging.INFO, format='%(message)s')

log = logging.getLogger("sd")


class Singleton(abc.ABCMeta, type):
    """
    Singleton metaclass for ensuring only one instance of a class.
    """

    _instances = {}

    def __call__(cls, *args, **kwargs):
        """Call method for the singleton metaclass."""
        if cls not in cls._instances:
            cls._instances[cls] = super(Singleton, cls).__call__(*args, **kwargs)
        return cls._instances[cls]


def compare_components_with_ids(components: list[Block], ids: list[int]):
    return len(components) == len(ids) and all(
        component._id == _id for component, _id in zip(components, ids)
    )


def get_component_by_elem_id(root: Block, elem_id: str):
    if root.elem_id == elem_id:
        return root

    elem = None
    if isinstance(root, BlockContext):
        for block in root.children:
            elem = get_component_by_elem_id(block, elem_id)
            if elem is not None:
                break

    return elem


def get_components_by_ids(root: Block, ids: list[int]):
    components: list[Block] = []

    if root._id in ids:
        components.append(root)
        ids = [_id for _id in ids if _id != root._id]

    if isinstance(root, BlockContext):
        for block in root.children:
            components.extend(get_components_by_ids(block, ids))

    return components


def detect_control_net(root: gr.Blocks, submit: gr.Button):
    UiControlNetUnit = None

    dependencies: list[dict] = [
        x
        for x in root.dependencies
        if x["trigger"] == "click" and submit._id in x["targets"]
    ]
    for d in dependencies:
        if len(d["outputs"]) == 1:
            outputs = get_components_by_ids(root, d["outputs"])
            output = outputs[0]
            if (
                isinstance(output, gr.State)
                and type(output.value).__name__ == "UiControlNetUnit"
            ):
                UiControlNetUnit = type(output.value)

    return UiControlNetUnit
