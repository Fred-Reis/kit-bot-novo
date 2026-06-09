import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  notificationsEnabled: boolean;
  autoRefresh: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setAutoRefresh: (v: boolean) => void;
}

/** Returns a plain setter that writes a single store key — avoids boilerplate `(v) => set({ key: v })`. */
const setter =
  <K extends keyof UiState>(set: (partial: Partial<UiState>) => void, key: K) =>
  (v: UiState[K]) =>
    set({ [key]: v } as Partial<UiState>);

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      darkMode: false,
      notificationsEnabled: true,
      autoRefresh: true,
      setSidebarCollapsed: setter(set, 'sidebarCollapsed'),
      setDarkMode: (v) => {
        document.documentElement.dataset.dark = v ? 'true' : '';
        set({ darkMode: v });
      },
      setNotificationsEnabled: setter(set, 'notificationsEnabled'),
      setAutoRefresh: setter(set, 'autoRefresh'),
    }),
    {
      name: 'kit-manager-ui',
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.dataset.dark = state.darkMode ? 'true' : '';
        }
      },
    }
  )
);
