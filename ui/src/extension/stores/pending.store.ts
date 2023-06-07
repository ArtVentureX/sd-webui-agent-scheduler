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
  pauseQueue: () => Promise<ResponseStatus>;
  resumeQueue: () => Promise<ResponseStatus>;
  runTask: (id: string) => Promise<ResponseStatus>;
  moveTask: (id: string, overId: string) => Promise<ResponseStatus>;
  deleteTask: (id: string) => Promise<ResponseStatus>;
};

export type PendingTasksStore = ReturnType<typeof createPendingTasksStore>;

export const createPendingTasksStore = (initialState: PendingTasksState) => {
  const store = createStore<PendingTasksState>()(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: PendingTasksActions = {
    refresh: async () => {
      return fetch('/agent-scheduler/v1/queue?limit=1000')
        .then((response) => response.json())
        .then((data: PendingTasksState) => {
          setState(data);
        });
    },
    pauseQueue: async () => {
      return fetch('/agent-scheduler/v1/pause', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          actions.refresh();
          return data;
        });
    },
    resumeQueue: async () => {
      return fetch('/agent-scheduler/v1/resume', { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          actions.refresh();
          return data;
        });
    },
    runTask: async (id: string) => {
      return fetch(`/agent-scheduler/v1/run/${id}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          actions.refresh();
          return data;
        });
    },
    moveTask: async (id: string, overId: string) => {
      return fetch(`/agent-scheduler/v1/move/${id}/${overId}`, { method: 'POST' })
        .then((response) => response.json())
        .then((data) => {
          actions.refresh();
          return data;
        });
    },
    deleteTask: async (id: string) => {
      return fetch(`/agent-scheduler/v1/delete/${id}`, { method: 'POST' }).then((response) =>
        response.json(),
      );
    },
  };

  return { getState, setState, subscribe, ...actions };
};
