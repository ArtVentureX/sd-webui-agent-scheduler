import { createStore } from 'zustand/vanilla';

type SelectedTab = 'history' | 'pending';

type SharedState = {
  selectedTab: SelectedTab;
};

type SharedActions = {
  selectSelectedTab: (tab: SelectedTab) => void;
};

export const createSharedStore = (initialState: SharedState) => {
  const store = createStore<SharedState>(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: SharedActions = {
    selectSelectedTab: (tab: SelectedTab) => {
      setState({ selectedTab: tab });
    },
  };

  return { getState, setState, subscribe, ...actions };
};
