/** Browser persistence: one workspace in localStorage, with corruption recovery. */
import { newWorkspace, parseWorkspaceJson, type Workspace } from '../engine';

export const WORKSPACE_KEY = 'source-trace.workspace.v1';
export const CORRUPT_KEY = 'source-trace.workspace.v1.corrupt';
export const BACKEND_KEY = 'source-trace.backend.v1';

export type LoadResult =
  | { kind: 'empty'; workspace: Workspace }
  | { kind: 'ok'; workspace: Workspace }
  | { kind: 'recovered'; workspace: Workspace; codes: string[] };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readItem(s: Storage | null, key: string): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function loadWorkspace(): LoadResult {
  const s = storage();
  const raw = readItem(s, WORKSPACE_KEY);
  if (raw === null) return { kind: 'empty', workspace: newWorkspace('My workspace') };
  const parsed = parseWorkspaceJson(raw);
  if (parsed.ok) return { kind: 'ok', workspace: parsed.workspace };
  try {
    s?.setItem(CORRUPT_KEY, raw);
  } catch {
    /* nothing more can be done */
  }
  return { kind: 'recovered', workspace: newWorkspace('My workspace'), codes: parsed.codes };
}

/** Returns an error message, or null on success. One setItem call: nothing half-written. */
export function saveWorkspace(workspace: Workspace): string | null {
  const s = storage();
  if (s === null) return 'Browser storage is unavailable, so changes will be lost on reload.';
  try {
    s.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    return null;
  } catch {
    return 'The browser refused to store the workspace (storage may be full). Export a backup now.';
  }
}

export function clearWorkspace(): void {
  try {
    storage()?.removeItem(WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
}

export interface BackendPrefs {
  enabled: boolean;
  url: string;
}
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8797';

export function loadBackendPrefs(): BackendPrefs {
  try {
    const raw = storage()?.getItem(BACKEND_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<BackendPrefs>;
      if (typeof v.enabled === 'boolean' && typeof v.url === 'string') {
        return { enabled: v.enabled, url: v.url };
      }
    }
  } catch {
    /* fall through */
  }
  return { enabled: false, url: DEFAULT_BACKEND_URL };
}

export function saveBackendPrefs(prefs: BackendPrefs): void {
  try {
    storage()?.setItem(BACKEND_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
