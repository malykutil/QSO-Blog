export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "ok2mkj-theme";
const THEME_CHANGE_EVENT = "ok2mkj-theme-change";

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const fromDataset = document.documentElement.dataset.theme;
  if (fromDataset === "dark" || fromDataset === "light") {
    return fromDataset;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyThemeMode(theme: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveThemeMode(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyThemeMode(theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeThemeMode(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getThemeServerSnapshot(): ThemeMode {
  return "light";
}

export const themeInitScript = `
  try {
    var storedTheme = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    var resolvedTheme = storedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  } catch (error) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
`;
