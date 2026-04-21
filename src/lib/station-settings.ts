export const HOME_LOCATOR_STORAGE_KEY = "qso-home-locator";
export const DEFAULT_HOME_LOCATOR = "JN99AK";
const HOME_LOCATOR_CHANGED_EVENT = "station-settings:changed";

export function normalizeLocator(value: string) {
  return value.trim().toUpperCase();
}

export function isValidLocator(value: string) {
  const locator = normalizeLocator(value);
  return /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(locator);
}

export function readHomeLocator() {
  if (typeof window === "undefined") {
    return DEFAULT_HOME_LOCATOR;
  }

  return normalizeLocator(window.localStorage.getItem(HOME_LOCATOR_STORAGE_KEY) ?? DEFAULT_HOME_LOCATOR);
}

export function saveHomeLocator(value: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HOME_LOCATOR_STORAGE_KEY, normalizeLocator(value));
  window.dispatchEvent(new Event(HOME_LOCATOR_CHANGED_EVENT));
}

export function subscribeHomeLocator(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === HOME_LOCATOR_STORAGE_KEY) {
      callback();
    }
  };

  const handleCustomChange = () => {
    callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(HOME_LOCATOR_CHANGED_EVENT, handleCustomChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(HOME_LOCATOR_CHANGED_EVENT, handleCustomChange);
  };
}

export function getHomeLocatorServerSnapshot() {
  return DEFAULT_HOME_LOCATOR;
}
