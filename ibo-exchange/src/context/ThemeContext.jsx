import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';

/** Bumped so prior dark prefs don't override the light product default. */
const STORAGE_KEY = 'ibo-exchange-theme-v3';
const LEGACY_STORAGE_KEYS = ['ibo-exchange-theme-v2', 'ibo-exchange-theme'];
const ThemeContext = createContext(null);

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    // Drop legacy keys — do not inherit old dark default
    for (const key of LEGACY_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
  return 'light';
}

export function applyThemeToDocument(theme) {
  const root = document.documentElement;
  const next = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  root.classList.remove('light', 'dark');
  root.classList.add(next);
  root.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', next === 'light' ? '#F3F4F6' : '#101013');
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useLayoutEffect(() => {
    applyThemeToDocument(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next === 'light' ? 'light' : 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isLight: theme === 'light',
      isDark: theme === 'dark',
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
