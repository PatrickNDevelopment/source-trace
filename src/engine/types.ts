/** Workspace data model, schema 1 (spec 03 §1). */
import type { Locator } from './locator';

export const STATUSES = ['draft', 'needs_review', 'approved', 'rejected', 'revise'] as const;
export type Status = (typeof STATUSES)[number];

export const KINDS = [
  'factual',
  'interpretation',
  'disputed',
  'fictional_canon',
  'creator_inference',
] as const;
export type Kind = (typeof KINDS)[number];

export const LABELS = ['support', 'contradiction', 'unknown'] as const;
export type Label = (typeof LABELS)[number];

export const SOURCE_ORIGINS = ['paste', 'file', 'pdf'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const CLAIM_ORIGINS = ['manual', 'ai_suggestion'] as const;
export type ClaimOrigin = (typeof CLAIM_ORIGINS)[number];

export const AUDIT_TYPES = [
  'created',
  'edited',
  'evidence_added',
  'evidence_removed',
  'evidence_labeled',
  'note',
  'transition',
  'approval_refused',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const BLOCKER_CODES = [
  'CLAIM_TEXT_EMPTY',
  'CONTRADICTION_PRESENT',
  'EVIDENCE_LOCATOR_INVALID',
  'EVIDENCE_SOURCE_MISSING',
  'NO_EVIDENCE',
  'NO_SUPPORT',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

export interface Source {
  id: string;
  title: string;
  author: string;
  date: string;
  provenance: string;
  url: string;
  rights: string;
  origin: SourceOrigin;
  text: string;
  contentHash: string;
  createdAt: string;
}

export interface Evidence {
  id: string;
  sourceId: string;
  locator: Locator;
  label: Label;
  note: string;
}

export interface AuditEvent {
  seq: number;
  at: string;
  actor: 'user';
  type: AuditType;
  note: string;
  from?: Status;
  to?: Status;
  codes?: BlockerCode[];
}

export interface Claim {
  id: string;
  text: string;
  kind: Kind;
  status: Status;
  evidence: Evidence[];
  reviewNote: string;
  audit: AuditEvent[];
  origin: ClaimOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  schema: 1;
  name: string;
  counters: { source: number; claim: number; evidence: number };
  sources: Source[];
  claims: Claim[];
}

export const LIMITS = {
  sources: 200,
  claims: 2000,
  evidencePerClaim: 50,
  auditPerClaim: 500,
  jsonBytes: 20_000_000,
} as const;
