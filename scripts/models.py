from datetime import datetime, timezone

from typing import Optional, List

from pydantic import BaseModel, Field


def convert_datetime_to_iso_8601_with_z_suffix(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z' if dt else None


def transform_to_utc_datetime(dt: datetime) -> datetime:
    return dt.astimezone(tz=timezone.utc)


class QueueStatusAPI(BaseModel):
    limit: Optional[int] = Field(title="Limit", description="The maximum number of tasks to return", default=20)
    offset: Optional[int] = Field(title="Offset", description="The offset of the tasks to return", default=0)


class TaskModel(BaseModel):
    id: str = Field(title="Task Id")
    api_task_id: Optional[str] = Field(title="API Task Id", default=None)
    type: str = Field(title="Task Type", description="Either txt2img or img2img")
    status: str = Field(title="Task Status", description="Either pending, running, done or failed")
    params: str = Field(title="Task Parameters", description="The parameters of the task in JSON format")
    priority: int = Field(title="Task Priority")
    result: Optional[str] = Field(title="Task Result", description="The result of the task in JSON format")
    created_at: Optional[datetime] = Field(title="Task Created At", description="The time when the task was created", default=None)
    updated_at: Optional[datetime] = Field(title="Task Updated At", description="The time when the task was updated", default=None)

    class Config:
        json_encoders = {
            # custom output conversion for datetime
            datetime: convert_datetime_to_iso_8601_with_z_suffix
        }


class QueueStatusResponse(BaseModel):
    current_task_id: Optional[str] = Field(title="Current Task Id", description="The on progress task id")
    pending_tasks: List[TaskModel] = Field(title="Pending Tasks", description="The pending tasks in the queue")
    total_pending_tasks: int = Field(title="Queue length", description="The total pending tasks in the queue")
    paused: bool = Field(title="Paused", description="Whether the queue is paused")
