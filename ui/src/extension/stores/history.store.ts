import { createStore } from 'zustand/vanilla';

import { ResponseStatus, Task, TaskHistoryResponse, TaskStatus } from '../types';

type HistoryTasksState = {
  total: number;
  tasks: Task[];
  status?: TaskStatus;
};

type HistoryTasksActions = {
  refresh: (options?: { limit?: number; offset?: number }) => Promise<TaskHistoryResponse>;
  onFilterStatus: (status?: TaskStatus) => void;
  bookmarkTask: (id: string, bookmarked: boolean) => Promise<ResponseStatus>;
  renameTask: (id: string, name: string) => Promise<ResponseStatus>;
  requeueTask: (id: string) => Promise<ResponseStatus>;
  requeueFailedTasks: () => Promise<ResponseStatus>;
  clearHistory: () => Promise<ResponseStatus>;
};

export type HistoryTasksStore = ReturnType<typeof createHistoryTasksStore>;

export const createHistoryTasksStore = (initialState: HistoryTasksState) => {
  const store = createStore<HistoryTasksState>()(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: HistoryTasksActions = {
    refresh: async options => {
      const { limit = 1000, offset = 0 } = options ?? {};
      const status = getState().status ?? '';

      return fetch(
        `/agent-scheduler-hysli/v1/history?status=${status}&limit=${limit}&offset=${offset}`
      )
        .then(response => response.json())
        .then((data: TaskHistoryResponse) => {
          setState({ ...data });
          return data;
        });
    },
    onFilterStatus: status => {
      setState({ status });
      actions.refresh();
    },
    bookmarkTask: async (id: string, bookmarked: boolean) => {
      return fetch(
        `/agent-scheduler-hysli/v1/task/${id}/${bookmarked ? 'bookmark' : 'unbookmark'}`,
        {
          method: 'POST',
        }
      ).then(response => response.json());
    },
    renameTask: async (id: string, name: string) => {
      return fetch(`/agent-scheduler-hysli/v1/task/${id}/rename?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then(response => response.json());
    },
    requeueTask: async (id: string) => {
      return fetch(`/agent-scheduler-hysli/v1/task/${id}/requeue`, { method: 'POST' }).then(
        response => response.json()
      );
    },
    requeueFailedTasks: async () => {
      return fetch('/agent-scheduler-hysli/v1/task/requeue-failed', { method: 'POST' }).then(
        response => {
          actions.refresh();
          return response.json();
        }
      );
    },
    clearHistory: async () => {
      return fetch('/agent-scheduler-hysli/v1/history/clear', { method: 'POST' }).then(response => {
        actions.refresh();
        return response.json();
      });
    },
  };

  return { getState, setState, subscribe, ...actions };
};
