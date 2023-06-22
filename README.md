# Agent Scheduler

Introducing AgentScheduler, an A1111/Vladmandic Stable Diffusion Web UI extension to power up your image generation workflow!

## Table of Content

- [Compatibility](#compatibility)
- [Installation](#installation)
  - [Using Vlad Fork](#using-vlads-webui-fork)
  - [Using the built-in extension list](#using-the-built-in-extension-list)
  - [Manual clone](#manual-clone)
- [Functionality](#functionality-as-of-current-version)
- [Settings](#extension-settings)
- [API Access](#api-access)
- [Troubleshooting](#troubleshooting)
- [Road Map](#road-map)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Compatibility

This version of AgentScheduler is compatible with latest versions of:

- A1111: [commit baf6946](https://github.com/AUTOMATIC1111/stable-diffusion-webui/commit/baf6946e06249c5af9851c60171692c44ef633e0)
- Vladmandic: [commit 9726b4d](https://github.com/vladmandic/automatic/commit/9726b4d23cb63779964e1d4edff49dd2c9c11e51)

> Older versions may not working properly.

## Installation

### Using Vlad's WebUI Fork

The extension is already included in [Vlad fork](https://github.com/vladmandic/automatic)'s builtin extensions.

### Using the built-in extension list

1. Open the Extensions tab
2. Open the "Install From URL" sub-tab
3. Paste the repo url: https://github.com/ArtVentureX/sd-webui-agent-scheduler.git
4. Click "Install"

![Install](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/f0fa740b-392a-4dd6-abe1-49c770ea60da)

### Manual clone

```bash
git clone "https://github.com/ArtVentureX/sd-webui-agent-scheduler.git" extensions/agent-scheduler
```

(The second argument specifies the name of the folder, you can choose whatever you like).

## Functionality [as of current version]

![Extension Walkthrough 1](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/a5a039a7-d98b-4186-9131-6775f0812c39)

1️⃣ Input your usual Prompts & Settings. **Enqueue** to send your current prompts, settings, controlnets to **AgentScheduler**.

![Extension Walkthrough 2](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/734176b4-7ee3-40e5-bb92-35608fabfc4b)

2️⃣ **AgentScheduler** Extension Tab.

3️⃣ See all queued tasks, current image being generated and tasks' associated information. **Drag and drop** the handle in the begining of each row to reaggrange the generation order.

4️⃣ **Pause** to stop queue auto generation. **Resume** to start.

5️⃣ Press ▶️ to prioritize selected task, or to start a single task when queue is paused. **Delete** tasks that you no longer want.

![ Extension Walkthrough 3](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/23109761-2633-4b24-bbb3-091628367047)

6️⃣ Show queue history.

7️⃣ **Filter** task status or search by text.

8️⃣ **Bookmark** task to easier filtering.

9️⃣ Double click the task id to **rename**. Click ↩️ to **Requeue** old task.

🔟 Click on each task to **view** the generation results.

https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/50c74922-b85f-493c-9be8-b8e78f0cd061

## Extension Settings

Go to `Settings > Agent Scheduler` to access extension settings.

![Settings](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/b0377ccd-f9bf-486e-8393-c06fe26aa117)

**Disable Queue Auto-Processing**: Check this option to disable queue auto-processing on start-up. You can also temporarily pause or resume the queue from the Extension tab.

**Queue Button Placement**: Change the placement of the queue button on the UI.

**Hide the Checkpoint Dropdown**: The Extension provides a custom checkpoint dropdown.

![Custom Checkpoint](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/d110d314-a208-4eec-bb54-9f8c73cb450b)

By default, queued tasks use the currently loaded checkpoint. However, changing the system checkpoint requires some time to load the checkpoint into memory, and you also cannot change the checkpoint during image generation. You can use this dropdown to quickly queue a task with a custom checkpoint.

**Auto Delete Queue History**: Select a timeframe to keep your queue history. Tasks that are older than the configured value will be automatically deleted. Please note that bookmarked tasks will not be deleted.

## API Access

All the functionality of this extension can be accessed through HTTP APIs. You can access the API documentation via `http://127.0.0.1:7860/docs`. Remember to include `--api` in your startup arguments.

![API docs](https://github.com/ArtVentureX/sd-webui-agent-scheduler/assets/133728487/012ab2cc-b41f-4c68-8fa5-7ab4e49aa91d)

#### Queue Task

The two apis `/agent-scheduler/v1/queue/txt2img` and `/agent-scheduler/v1/queue/img2img` support all the parameters of the original webui apis. These apis response the task id, which can be used to perform updates later.

```json
{
  "task_id": "string"
}
```

#### Download Results

Use api `/agent-scheduler/v1/results/{id}` to get the generated images. The api supports two response format:

- json with base64 encoded

```json
{
  "success": true,
  "data": [
    {
      "image": "data:image/png;base64,iVBORw0KGgoAAAAN...",
      "infotext": "1girl\nNegative prompt: EasyNegative, badhandv4..."
    },
    {
      "image": "data:image/png;base64,iVBORw0KGgoAAAAN...",
      "infotext": "1girl\nNegative prompt: EasyNegative, badhandv4..."
    }
  ]
}
```

- zip file with querystring `zip=true`

## Troubleshooting

Make sure that you are running the latest version of the extension and an updated version of the WebUI.

- To update the extension, go to `Extension` tab and click `Check for Updates`, then click `Apply and restart UI`.
- To update the WebUI it self, you run the command `git pull origin master` in the same folder as webui.bat (or webui.sh).

Steps to try to find the cause of issues:

- Check the for errors in the WebUI output console.
- Press F12 in the browser then go to the console tab and reload the page, find any error message here.

Common errors:

**AttributeError: module 'modules.script_callbacks' has no attribute 'on_before_reload'**

If you see this error message in the output console, try update the WebUI to the latest version.

**ReferenceError: submit_enqueue is not defined**

If you click the `Enqueue` button and nothing happen, and you find above error message in the browser F12 console, follow the steps in [this comment](https://github.com/ArtVentureX/sd-webui-agent-scheduler/issues/4#issuecomment-1575986274).

For other errors, feel free to fire a new [Github issue](https://github.com/ArtVentureX/sd-webui-agent-scheduler/issues/new/choose).

## Road Map

To list possible feature upgrades for this extension

- Connect multiple SD webui nodes to run task.
- Sync with GenAI Management Platform **ArtVenture**

## Contributing

We welcome contributions to the Agent Scheduler Extension project! Please feel free to submit issues, bug reports, and feature requests through the GitHub repository.

Please give us a ⭐ if you find this extension helpful!

## License

This project is licensed under the Apache License 2.0.

## Disclaimer

The author(s) of this project are not responsible for any damages or legal issues arising from the use of this software. Users are solely responsible for ensuring that they comply with any applicable laws and regulations when using this software and assume all risks associated with its use. The author(s) are not responsible for any copyright violations or legal issues arising from the use of input or output content.

---

## CRAFTED BY THE PEOPLE BUILDING **ARTVENTURE**, [**ATHERLABS**](https://atherlabs.com/) & [**SIPHER ODYSSEY**](http://playsipher.com/)

### About ArtVenture (coming soon™️)

ArtVenture offers powerful collaboration features for Generative AI Image workflows. It is designed to help designers and creative professionals of all levels collaborate more efficiently, unleash their creativity, and have full transparency and tracking over the creation process.

![ArtVenture Teaser](https://user-images.githubusercontent.com/90659883/236376930-831ac345-e979-4ec5-bece-49e4bc497b79.png)

![ArtVenture Teaser 2](https://user-images.githubusercontent.com/90659883/236376933-babe9d36-f42f-4c1c-b59a-08be572a1f4c.png)

### Current Features

ArtVenture offers the following key features:

- Seamless Access: available on desktop and mobile
- Multiplayer & Collaborative UX. Strong collaboration features, such as real-time commenting and feedback, version control, and image/file/project sharing.
- Powerful semantic search capabilities.
- Building on shoulders of Giants, leveraging A1111/Vladnmandic and other pioneers, provide collaboration process from Idea (Sketch/Thoughts/Business Request) to Final Results(Images/Copywriting Post/TaskCompleted) in 1 platform
- Automation tooling for certain repeated tasks
- Secure and transparent, leveraging hasing and metadata to track the origin and history of models, loras, images to allow for tracability and ease of collaboration.
- Personalize UX for both beginner and experienced users to quickly remix existing SD images by editing prompts and negative prompts, selecting new training models and output quality as desired.

### Target Audience

ArtVenture is designed for the following target audiences:

- Casual Creators
- Small Design Teams or Freelancers
- Design Agencies & Studios

## 🎉 Stay Tuned for Updates

We hope you find this extension to be useful. We will be adding new features and improvements over time as we enhance this extension to support our creative workflows.

To stay up-to-date with the latest news and updates, be sure to follow us on GitHub and Twitter (coming soon™️). We welcome your feedback and suggestions, and are excited to hear how AgentScheduler can help you streamline your workflow and unleash your creativity!
