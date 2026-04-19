import { describe, test, expect, beforeEach } from 'vitest';
import { useUiStore } from '@/store/ui';

// Reset store before each test
beforeEach(() => {
  useUiStore.setState({ sidebarCollapsed: false, darkMode: false });
  document.documentElement.dataset.dark = '';
});

describe('useUiStore', () => {
  test('initial state: sidebar expanded, dark mode off', () => {
    const { sidebarCollapsed, darkMode } = useUiStore.getState();
    expect(sidebarCollapsed).toBe(false);
    expect(darkMode).toBe(false);
  });

  test('setSidebarCollapsed toggles sidebar', () => {
    const { setSidebarCollapsed } = useUiStore.getState();
    setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    setSidebarCollapsed(false);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  test('setDarkMode(true) sets darkMode state and html data-dark attribute', () => {
    const { setDarkMode } = useUiStore.getState();
    setDarkMode(true);
    expect(useUiStore.getState().darkMode).toBe(true);
    expect(document.documentElement.dataset.dark).toBe('true');
  });

  test('setDarkMode(false) clears darkMode state and html data-dark attribute', () => {
    const { setDarkMode } = useUiStore.getState();
    setDarkMode(true);
    setDarkMode(false);
    expect(useUiStore.getState().darkMode).toBe(false);
    expect(document.documentElement.dataset.dark).toBe('');
  });
});
