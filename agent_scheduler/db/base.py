import os

from sqlalchemy import create_engine
from sqlalchemy.schema import MetaData
from sqlalchemy.orm import declarative_base

from modules import scripts
from modules import shared

if hasattr(shared.cmd_opts, "agent_scheduler_sqlite_file"):
    # if relative path, join with basedir
    if not os.path.isabs(shared.cmd_opts.agent_scheduler_sqlite_file):
        db_file = os.path.join(scripts.basedir(), shared.cmd_opts.agent_scheduler_sqlite_file)
    else:
        db_file = os.path.abspath(shared.cmd_opts.agent_scheduler_sqlite_file)

print(f"Using sqlite file: {db_file}")


Base = declarative_base()
metadata: MetaData = Base.metadata

class BaseTableManager:
    def __init__(self, engine = None):
        # Get the db connection object, making the file and tables if needed.
        try:
            self.engine = engine if engine else create_engine(f"sqlite:///{db_file}")
        except Exception as e:
            print(f"Exception connecting to database: {e}")
            raise e

    def get_engine(self):
        return self.engine

    # Commit and close the database connection.
    def quit(self):
        self.engine.dispose()
