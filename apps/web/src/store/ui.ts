import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  darkMode: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setDarkMode: (v) => {
    document.documentElement.dataset.dark = v ? 'true' : '';
    set({ darkMode: v });
  },
}));
