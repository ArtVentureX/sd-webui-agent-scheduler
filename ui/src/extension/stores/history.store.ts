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
};

export type HistoryTasksStore = ReturnType<typeof createHistoryTasksStore>;

export const createHistoryTasksStore = (initialState: HistoryTasksState) => {
  const store = createStore<HistoryTasksState>()(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: HistoryTasksActions = {
    refresh: async (options) => {
      const { limit = 1000, offset = 0 } = options ?? {};
      const status = getState().status ?? '';

      return fetch(`/agent-scheduler/v1/history?status=${status}&limit=${limit}&offset=${offset}`)
        .then((response) => response.json())
        .then((data: TaskHistoryResponse) => {
          setState({ ...data });
          return data;
        });
    },
    onFilterStatus: (status) => {
      setState({ status });
      actions.refresh();
    },
    bookmarkTask: async (id: string, bookmarked: boolean) => {
      return fetch(`/agent-scheduler/v1/${bookmarked ? 'bookmark' : 'unbookmark'}/${id}`, {
        method: 'POST',
      }).then((response) => response.json());
    },
    renameTask: async (id: string, name: string) => {
      return fetch(`/agent-scheduler/v1/rename/${id}?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then((response) => response.json());
    },
    requeueTask: async (id: string) => {
      return fetch(`/agent-scheduler/v1/requeue/${id}`, { method: 'POST' }).then((response) =>
        response.json(),
      );
    },
  };

  return { getState, setState, subscribe, ...actions };
};
