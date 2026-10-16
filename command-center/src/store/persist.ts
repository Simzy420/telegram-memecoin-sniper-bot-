const PREFIX = 'cc.v1.';

let persistEnabled = true;

export function setPersistEnabled(on: boolean) {
  persistEnabled = on;
}

export function isPersistEnabled(): boolean {
  return persistEnabled;
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (!persistEnabled) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Always write, including when Guest mode has turned `writeJson` off.
 * Returns false when `setItem` throws (quota, private mode, or storage disabled).
 */
export function writeJsonForced(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeJson(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
