import { createStore } from 'zustand/vanilla';

import { ResponseStatus, Task } from '../types';

type PendingTasksState = {
  current_task_id: string | null;
  total_pending_tasks: number;
  pending_tasks: Task[];
  paused: boolean;
};

type PendingTasksActions = {
  refresh: () => Promise<void>;
  exportQueue: () => Promise<string>;
  importQueue: (str: string) => Promise<ResponseStatus>;
  pauseQueue: () => Promise<ResponseStatus>;
  resumeQueue: () => Promise<ResponseStatus>;
  clearQueue: () => Promise<ResponseStatus>;
  runTask: (id: string) => Promise<ResponseStatus>;
  moveTask: (id: string, overId: string) => Promise<ResponseStatus>;
  updateTask: (id: string, task: Task) => Promise<ResponseStatus>;
  deleteTask: (id: string) => Promise<ResponseStatus>;
};

export type PendingTasksStore = ReturnType<typeof createPendingTasksStore>;

export const createPendingTasksStore = (initialState: PendingTasksState) => {
  const store = createStore<PendingTasksState>()(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: PendingTasksActions = {
    refresh: async () => {
      return fetch('/agent-scheduler-hysli/v1/queue?limit=1000')
        .then(response => response.json())
        .then(setState);
    },
    exportQueue: async () => {
      return fetch('/agent-scheduler-hysli/v1/export').then(response => response.json());
    },
    importQueue: async (str: string) => {
      const bodyObj = {
        content: str,
      };
      return fetch(`/agent-scheduler-hysli/v1/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      })
        .then(response => response.json())
        .then(data => {
          setTimeout(() => {
            actions.refresh();
          }, 3000);
          return data;
        });
    },
    pauseQueue: async () => {
      return fetch('/agent-scheduler-hysli/v1/queue/pause', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
          setTimeout(() => {
            actions.refresh();
          }, 500);
          return data;
        });
    },
    resumeQueue: async () => {
      return fetch('/agent-scheduler-hysli/v1/queue/resume', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
          setTimeout(() => {
            actions.refresh();
          }, 500);
          return data;
        });
    },
    clearQueue: async () => {
      return fetch('/agent-scheduler-hysli/v1/queue/clear', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
          actions.refresh();
          return data;
        });
    },
    runTask: async (id: string) => {
      return fetch(`/agent-scheduler-hysli/v1/task/${id}/run`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
          setTimeout(() => {
            actions.refresh();
          }, 500);
          return data;
        });
    },
    moveTask: async (id: string, overId: string) => {
      return fetch(`/agent-scheduler-hysli/v1/task/${id}/move/${overId}`, { method: 'POST' })
        .then(response => response.json())
        .then(data => {
          actions.refresh();
          return data;
        });
    },
    updateTask: async (id: string, task: Task) => {
      const newValue = {
        name: task.name,
        checkpoint: task.params.checkpoint,
        params: {
          prompt: task.params.prompt,
          negative_prompt: task.params.negative_prompt,
          sampler_name: task.params.sampler_name,
          steps: task.params.steps,
          cfg_scale: task.params.cfg_scale,
        },
      };
      return fetch(`/agent-scheduler-hysli/v1/task/${id}`, {
        method: 'PUT',
        body: JSON.stringify(newValue),
        headers: { 'Content-Type': 'application/json' },
      }).then(response => response.json());
    },
    deleteTask: async (id: string) => {
      return fetch(`/agent-scheduler-hysli/v1/task/${id}`, { method: 'DELETE' }).then(response =>
        response.json()
      );
    },
  };

  return { getState, setState, subscribe, ...actions };
};
