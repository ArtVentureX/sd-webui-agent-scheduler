# preload.py is used for cmd line arguments
def preload(parser):
    parser.add_argument(
        "--sqlite-file",
        help="sqlite file to use for the database connection. It can be abs or relative path(from base path) default: task_scheduler.sqlite3",
        default="task_scheduler.sqlite3",
    )