from enum import Enum
from typing import Union

from sqlalchemy import Column, String
from sqlalchemy.orm import Session

from .base import BaseTableManager, Base


class AppStateKey(str, Enum):
    Version = "version"
    QueueState = "queue_state"  # paused or running


class AppState:
    def __init__(self, key: str, value: str):
        self.key: str = key
        self.value: str = value

    @staticmethod
    def from_table(table: "AppStateTable"):
        return AppState(table.key, table.value)

    def to_table(self):
        return AppStateTable(key=self.key, value=self.value)


class AppStateTable(Base):
    __tablename__ = "app_state"

    key = Column(String(64), primary_key=True)
    value = Column(String(255), nullable=True)

    def __repr__(self):
        return f"AppState(key={self.key!r}, value={self.value!r})"


class AppStateManager(BaseTableManager):
    def get_value(self, key: str) -> Union[str, None]:
        session = Session(self.engine)
        try:
            result = session.get(AppStateTable, key)
            if result:
                return result.value
            else:
                return None
        except Exception as e:
            print(f"Exception getting value from database: {e}")
            raise e
        finally:
            session.close()

    def set_value(self, key: str, value: str):
        session = Session(self.engine)
        try:
            result = session.get(AppStateTable, key)
            if result:
                result.value = value
            else:
                result = AppStateTable(key=key, value=value)
                session.add(result)
            session.commit()
        except Exception as e:
            print(f"Exception setting value in database: {e}")
            raise e
        finally:
            session.close()

    def delete_value(self, key: str):
        session = Session(self.engine)
        try:
            result = session.get(AppStateTable, key)
            if result:
                session.delete(result)
                session.commit()
        except Exception as e:
            print(f"Exception deleting value from database: {e}")
            raise e
        finally:
            session.close()
