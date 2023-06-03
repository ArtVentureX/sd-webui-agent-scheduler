from enum import Enum
from datetime import datetime
from typing import Optional, Union

from sqlalchemy import Column, String, Text, Integer, DateTime, LargeBinary, text, func
from sqlalchemy.orm import Session

from .base import BaseTableManager, Base
from ..models import TaskModel


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Task(TaskModel):
    script_params: bytes = None

    def __init__(
        self,
        id: str = "",
        api_task_id: str = None,
        type: str = "unknown",
        params: str = "",
        script_params: bytes = b"",
        priority: int = None,
        status: str = TaskStatus.PENDING.value,
        result: str = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        priority = priority if priority else int(datetime.utcnow().timestamp() * 1000)

        super().__init__(
            id=id,
            api_task_id=api_task_id,
            type=type,
            params=params,
            status=status,
            priority=priority,
            result=result,
            created_at=created_at,
            updated_at=created_at,
        )
        self.id: str = id
        self.api_task_id: str = api_task_id
        self.type: str = type
        self.params: str = params
        self.script_params: bytes = script_params
        self.priority: int = priority
        self.status: str = status
        self.result: str = result
        self.created_at: datetime = created_at
        self.updated_at: datetime = updated_at

    class Config(TaskModel.__config__):
        exclude = ["script_params"]

    @staticmethod
    def from_table(table: "TaskTable"):
        return Task(
            id=table.id,
            api_task_id=table.api_task_id,
            type=table.type,
            params=table.params,
            script_params=table.script_params,
            priority=table.priority,
            status=table.status,
            created_at=table.created_at,
            updated_at=table.updated_at,
        )

    def to_table(self):
        return TaskTable(
            id=self.id,
            api_task_id=self.api_task_id,
            type=self.type,
            params=self.params,
            script_params=self.script_params,
            priority=self.priority,
            status=self.status,
        )


class TaskTable(Base):
    __tablename__ = "task"

    id = Column(String(64), primary_key=True)
    api_task_id = Column(String(64), nullable=True)
    type = Column(String(20), nullable=False)  # txt2img or img2txt
    params = Column(Text, nullable=False)  # task args
    script_params = Column(LargeBinary, nullable=False)  # script args
    priority = Column(Integer, nullable=False, default=datetime.now)
    status = Column(
        String(20), nullable=False, default="pending"
    )  # pending, running, done, failed
    result = Column(Text)  # task result
    created_at = Column(
        DateTime,
        nullable=False,
        server_default=text("(datetime('now'))"),
    )
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=text("(datetime('now'))"),
        onupdate=text("(datetime('now'))"),
    )

    def __repr__(self):
        return f"Task(id={self.id!r}, type={self.type!r}, params={self.params!r}, status={self.status!r}, created_at={self.created_at!r})"


class TaskManager(BaseTableManager):
    def get_task(self, id: str) -> Union[TaskTable, None]:
        session = Session(self.engine)
        try:
            task = session.get(TaskTable, id)

            return Task.from_table(task) if task else None
        except Exception as e:
            print(f"Exception getting task from database: {e}")
            raise e
        finally:
            session.close()

    def get_tasks(
        self,
        type: str = None,
        status: str = None,
        limit: int = None,
        offset: int = None,
    ) -> list[TaskTable]:
        session = Session(self.engine)
        try:
            query = session.query(TaskTable)
            if type:
                query = query.filter(TaskTable.type == type)

            if status:
                query = query.filter(TaskTable.status == status)

            query = query.order_by(TaskTable.priority.asc()).order_by(
                TaskTable.created_at.asc()
            )

            if limit:
                query = query.limit(limit)

            if offset:
                query = query.offset(offset)

            all = query.all()
            return [Task.from_table(t) for t in all]
        except Exception as e:
            print(f"Exception getting tasks from database: {e}")
            raise e
        finally:
            session.close()

    def count_tasks(
        self,
        type: str = None,
        status: str = None,
    ) -> int:
        session = Session(self.engine)
        try:
            query = session.query(TaskTable)
            if type:
                query = query.filter(TaskTable.type == type)

            if status:
                query = query.filter(TaskTable.status == status)

            return query.count()
        except Exception as e:
            print(f"Exception counting tasks from database: {e}")
            raise e
        finally:
            session.close()

    def add_task(self, task: Task) -> TaskTable:
        session = Session(self.engine)
        try:
            result = task.to_table()
            session.add(result)
            session.commit()
            return result
        except Exception as e:
            print(f"Exception adding task to database: {e}")
            raise e
        finally:
            session.close()

    def update_task(self, id: str, status: str, result=None) -> TaskTable:
        session = Session(self.engine)
        try:
            task = session.get(TaskTable, id)
            if task:
                task.status = status
                task.result = result
                session.commit()
                return task
            else:
                raise Exception(f"Task with id {id} not found")
        except Exception as e:
            print(f"Exception updating task in database: {e}")
            raise e
        finally:
            session.close()

    def prioritize_task(self, id: str, priority: int) -> TaskTable:
        """0 means move to top, -1 means move to bottom, otherwise set the exact priority"""

        session = Session(self.engine)
        try:
            result = session.get(TaskTable, id)
            if result:
                if priority == 0:
                    result.priority = self.__get_min_priority() - 1
                elif priority == -1:
                    result.priority = int(datetime.utcnow().timestamp() * 1000)
                else:
                    self.__move_tasks_down(priority)
                    session.execute(text("SELECT 1"))
                    result.priority = priority

                session.commit()
                return result
            else:
                raise Exception(f"Task with id {id} not found")
        except Exception as e:
            print(f"Exception updating task in database: {e}")
            raise e
        finally:
            session.close()

    def delete_task(self, id: str):
        session = Session(self.engine)
        try:
            result = session.get(TaskTable, id)
            if result:
                session.delete(result)
                session.commit()
            else:
                raise Exception(f"Task with id {id} not found")
        except Exception as e:
            print(f"Exception deleting task from database: {e}")
            raise e
        finally:
            session.close()

    def delete_tasks_before(self, before: datetime, all: bool = False):
        session = Session(self.engine)
        try:
            query = session.query(TaskTable).filter(TaskTable.created_at < before)
            if not all:
                query = query.filter(
                    TaskTable.status.in_([TaskStatus.DONE, TaskStatus.FAILED])
                )

            query.delete()
            session.commit()
        except Exception as e:
            print(f"Exception deleting tasks from database: {e}")
            raise e
        finally:
            session.close()

    def __get_min_priority(self) -> int:
        session = Session(self.engine)
        try:
            min_priority = session.query(func.min(TaskTable.priority)).scalar()
            return min_priority if min_priority else 0
        except Exception as e:
            print(f"Exception getting min priority from database: {e}")
            raise e
        finally:
            session.close()

    def __move_tasks_down(self, priority: int):
        session = Session(self.engine)
        try:
            session.query(TaskTable).filter(TaskTable.priority >= priority).update(
                {TaskTable.priority: TaskTable.priority + 1}
            )
            session.commit()
        except Exception as e:
            print(f"Exception moving tasks down in database: {e}")
            raise e
        finally:
            session.close()
