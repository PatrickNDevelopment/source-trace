/** Client for the optional local backend. Nothing here runs unless the user chose to connect. */
import type { Kind, Label, Workspace } from '../engine';

export interface Capabilities {
  version: string;
  pdf: { enabled: boolean; maxBytes: number; maxPages: number; timeoutSeconds: number };
  ai: {
    enabled: boolean;
    provider: string | null;
    model: string | null;
    requiresOptIn: boolean;
    promptVersion: string;
    limits: { callsPerHour: number; maxSources: number; maxSourceCharacters: number };
  };
  storage: { kind: string; maxSnapshotBytes: number };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Suggestion {
  claimText: string;
  kind: Kind;
  sourceId: string;
  start: number;
  end: number;
  text: string;
  label: Label;
  rationale: string;
}

async function call<T>(
  base: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/+$/, '')}${path}`, { ...init, signal: ctl.signal });
  } catch {
    throw new ApiError(0, 'backend_offline', 'The backend did not answer. Is it running?');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      'bad_response',
      'The backend sent a response that is not JSON.',
    );
  }
  if (!response.ok) {
    const e = (
      body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    ).error;
    throw new ApiError(
      response.status,
      e?.code ?? 'http_error',
      e?.message ?? `HTTP ${response.status}`,
      e?.details,
    );
  }
  return body as T;
}

export const api = {
  capabilities: (base: string) => call<Capabilities>(base, '/api/capabilities', {}, 3000),
  getWorkspace: (base: string, id: string) =>
    call<{ id: string; revision: number; updatedAt: string; workspace: Workspace }>(
      base,
      `/api/workspaces/${id}`,
    ),
  putWorkspace: (base: string, id: string, workspace: Workspace, baseRevision: number | null) =>
    call<{ id: string; revision: number; updatedAt: string }>(base, `/api/workspaces/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision, workspace }),
    }),
  extractPdf: (base: string, file: File) =>
    call<{ text: string; pages: number; characters: number; contentHash: string }>(
      base,
      '/api/pdf/extract',
      { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file },
      20_000,
    ),
  suggest: (
    base: string,
    body: {
      task: 'suggest_claims' | 'find_evidence';
      sources: { id: string; title: string; text: string }[];
      claimText?: string;
    },
  ) =>
    call<{
      suggestions: Suggestion[];
      meta: { provider: string; model: string; promptVersion: string; rejected: number };
    }>(
      base,
      '/api/ai/suggest',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-SourceTrace-AI-Opt-In': 'session' },
        body: JSON.stringify(body),
      },
      40_000,
    ),
};
