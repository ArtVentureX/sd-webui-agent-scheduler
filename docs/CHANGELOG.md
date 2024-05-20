# Change Logs

## 2023/08/10

New features:
- New API `/task/{id}/position` to get task position in queue [#105](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/105)
- Display task in local timezone [#95](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/95)

Bugs fixing:
- `alwayson_scripts` should allow script name in all cases [#102](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/102)
- Fix `script_args` not working when queue task via API [#103](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/103)

## 2023/08/02

Bugs fixing:
- Fix task_id is duplicated [#97](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/97)
- Fix [#100](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/100)

## 2023/07/25

New features:
- Clear queue and clear history
- Queue task with specific name & queue with all checkpoints [#88](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/88)

## 2023/07/24

New features:
- New API `/task/{id}` to get single task (https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/86)
- Update queued task
- Minor change to support changes in SD webui 1.5.0-RC

Bugs fixing:
- Fixed https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/87

## 2023/07/16

- Use pickle to serialize script args
- Fix task re-ordering not working [#79](https://github.com/ArtVentureX/sd-webui-agent-scheduler-hysli/issues/79)

## 2023/07/12

- Fix: batch_size is ignored when queue img2img task via api

## 2023/07/11

- Add clip_skip to queue params
- Add support for api task callback

## 2023/06/29

- Switch js format to iife
- Bugs fixing

## 2023/06/23

- Add setting to disable keyboard shortcut
- Bugs fixing

## 2023/06/21

- Add enqueue keyboard shortcut
- Bugs fixing

## 2023/06/20

- Add api to download task's generated images
- Add setting to render extension UI below the main UI
- Display task datetime in local timezone
- Persist the grid state (columns order, sorting) for next session
- Bugs fixing

## 2023/06/07

- Re-organize folder structure for better loading time
- Prevent duplicate ui initialization
- Prevent unnecessary data refresh

## 2023/06/06

- Force image saving when run task
- Auto pause queue when OOM error detected

## 2023/06/05

- Able to view queue history
- Bookmark task
- Rename task
- Requeue a task
- View generated images of a task
- Send generation params directly to txt2img, img2img
- Add apis to queue task
- Bugs fixing

## 2023/06/02

- Remove the queue placement option `Above Generate Button`
- Make the grid height scale with window resize
- Keep the previous generation result when click enqueue
- Fix: unable to run a specific task when queue is paused

## 2023/06/01

- Add a flag to enable/disable queue auto processing
- Add queue button placement setting
- Add a flag to hide the custom checkpoint select
- Rewrite frontend code in typescript
- Bugs fixing

## 2023/05/29

- First release
