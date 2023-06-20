import { createStore } from 'zustand/vanilla';

type SelectedTab = 'history' | 'pending';

type SharedState = {
  uiAsTab: boolean;
  selectedTab: SelectedTab;
};

type SharedActions = {
  setSelectedTab: (tab: SelectedTab) => void;
};

export const createSharedStore = (initialState: SharedState) => {
  const store = createStore<SharedState>(() => initialState);
  const { getState, setState, subscribe } = store;

  const actions: SharedActions = {
    setSelectedTab: (tab: SelectedTab) => {
      setState({ selectedTab: tab });
    },
  };

  return { getState, setState, subscribe, ...actions };
};
