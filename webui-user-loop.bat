@echo off

set LOGFILE=batch.log

cls

set PYTHON=
set GIT=
set VENV_DIR=
set COMMANDLINE_ARGS=--autolaunch --update-check --xformers --api --theme dark
set XFORMERS_PACKAGE=xformers==0.0.20

cd ..
cd ..

:start
echo "loop Start"
call webui.bat < batch.log
echo "looped"
goto start