import { createContext, useContext, type ReactNode } from 'react';
import type { BlockerCode, Kind, Label, OpResult, Status, Workspace } from '../engine';
import type { Capabilities } from '../lib/api';

export type View = 'sources' | 'review' | 'report' | 'settings' | 'about';

export type NoticeKind = 'info' | 'success' | 'error';

export interface BackendState {
  enabled: boolean;
  url: string;
  status: 'off' | 'connecting' | 'online' | 'offline';
  caps: Capabilities | null;
  revision: number | null;
  error: string;
  aiOptIn: boolean;
  setAiOptIn: (value: boolean) => void;
  connect: (url: string) => Promise<void>;
  disconnect: () => void;
  saveToBackend: () => Promise<void>;
  loadFromBackend: () => Promise<void>;
}

export interface AppApi {
  ws: Workspace;
  replaceWorkspace: (next: Workspace, message: string) => void;
  /** Runs an operation and applies its workspace (including a recorded refused approval). */
  run: <T>(op: (ws: Workspace, at: string) => OpResult<T>) => OpResult<T>;
  notify: (kind: NoticeKind, text: string) => void;
  backend: BackendState;
  selectedSourceId: string;
  setSelectedSourceId: (id: string) => void;
  selectedClaimId: string;
  setSelectedClaimId: (id: string) => void;
  go: (view: View) => void;
}

const Ctx = createContext<AppApi | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppApi;
  children: ReactNode;
}): ReactNode {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error('AppProvider missing');
  return v;
}

export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  revise: 'Revise',
};

export const KIND_LABEL: Record<Kind, string> = {
  factual: 'Factual claim',
  interpretation: 'Interpretation',
  disputed: 'Disputed assertion',
  fictional_canon: 'Fictional canon assertion',
  creator_inference: 'Creator inference',
};

export const LABEL_TEXT: Record<Label, string> = {
  support: 'Supports',
  contradiction: 'Contradicts',
  unknown: 'Unknown',
};

export const BLOCKER_MESSAGE: Record<BlockerCode, string> = {
  CLAIM_TEXT_EMPTY: 'The claim text is empty.',
  NO_EVIDENCE: 'This claim cites no source passage.',
  NO_SUPPORT:
    'No cited passage is labelled "Supports" and still matches its source, so nothing backs this claim.',
  EVIDENCE_SOURCE_MISSING: 'A cited passage points at a source that is not in the workspace.',
  EVIDENCE_LOCATOR_INVALID: 'A cited passage no longer matches its source text.',
  CONTRADICTION_PRESENT:
    'Contradicting evidence is attached. Only a claim of kind "Disputed assertion" can be approved with it.',
};

export function StatusBadge({ status }: { status: Status }): ReactNode {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function short(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cps = Array.from(flat);
  return cps.length <= max ? flat : `${cps.slice(0, max - 1).join('')}…`;
}
