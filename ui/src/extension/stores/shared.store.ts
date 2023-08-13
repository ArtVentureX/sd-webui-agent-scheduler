import { createStore } from 'zustand/vanilla';

type SelectedTab = 'history' | 'pending';

type SharedState = {
  uiAsTab: boolean;
  selectedTab: SelectedTab;
};

type SharedActions = {
  setSelectedTab: (tab: SelectedTab) => void;
  getSamplers: () => Promise<string[]>;
  getCheckpoints: () => Promise<string[]>;
};

export const createSharedStore = (initialState: SharedState) => {
  const store = createStore<SharedState>(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: SharedActions = {
    setSelectedTab: (tab: SelectedTab) => {
      setState({ selectedTab: tab });
    },
    getSamplers: async () => {
      return fetch('/sdapi/v1/samplers')
        .then(response => response.json())
        .then(data => data.map((item: any) => item.name));
    },
    getCheckpoints: async () => {
      return fetch('/sdapi/v1/sd-models')
        .then(response => response.json())
        .then(data => data.map((item: any) => item.title));
    },
  };

  return { getState, setState, subscribe, ...actions };
};
