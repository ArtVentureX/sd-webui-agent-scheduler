import launch

if not launch.is_installed("sqlalchemy"):
    launch.run_pip("install sqlalchemy", "requirement for task-scheduler")

if not launch.is_installed("boto3"):
    launch.run_pip("install boto3", "requirement for task-scheduler")