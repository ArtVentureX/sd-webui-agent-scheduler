# Change Logs

## 2023/07/16

- Use pickle to serialize script args

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
