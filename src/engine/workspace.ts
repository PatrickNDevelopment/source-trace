/**
 * Spec 03 §1: workspace validation (shared contract). Never throws. The Python twin is
 * backend/source_trace/engine/workspace.py and the two are held together by the vectors and the
 * differential fuzz, so keep rule order and codes identical.
 */
import { contentHash, verifyLocator } from './locator';
import { approvalBlockers, canTransition } from './state';
import { cpLength, hasLoneSurrogate, textProblems } from './text';
import {
  AUDIT_TYPES,
  BLOCKER_CODES,
  CLAIM_ORIGINS,
  KINDS,
  LABELS,
  LIMITS,
  SOURCE_ORIGINS,
  STATUSES,
  type Claim,
  type Source,
  type Workspace,
} from './types';

type Json = unknown;
type Obj = Record<string, Json>;

const MAX_INT = 999_999_999;
const TS_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;
const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function isObj(v: Json): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIntegral(v: Json): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

export function isRealDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d <= days;
}

class Check {
  readonly codes = new Set<string>();

  /** Verifies the exact key set; returns false when keys are missing or extra. */
  keys(obj: Obj, required: readonly string[], optional: readonly string[] = []): boolean {
    let ok = true;
    for (const k of required) {
      if (!(k in obj)) {
        this.codes.add('FIELD_MISSING');
        ok = false;
      }
    }
    const allowed = new Set([...required, ...optional]);
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) {
        this.codes.add('UNKNOWN_FIELD');
        ok = false;
      }
    }
    return ok;
  }

  /** A string field with a code-point length range. Returns the string, or undefined if bad. */
  str(v: Json, min: number, max: number): string | undefined {
    if (typeof v !== 'string') {
      this.codes.add('FIELD_TYPE');
      return undefined;
    }
    let good = true;
    if (hasLoneSurrogate(v)) {
      this.codes.add('TEXT_INVALID_UNICODE');
      good = false;
    }
    if (v.includes('\u0000')) {
      this.codes.add('TEXT_CONTAINS_NUL');
      good = false;
    }
    const n = cpLength(v);
    if (n < min || n > max) {
      this.codes.add('FIELD_VALUE');
      good = false;
    }
    return good ? v : undefined;
  }

  enumStr<T extends string>(v: Json, allowed: readonly T[]): T | undefined {
    const s = this.str(v, 0, 64);
    if (s === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(s)) {
      this.codes.add('FIELD_VALUE');
      return undefined;
    }
    return s as T;
  }

  int(v: Json, min: number, max: number): number | undefined {
    if (typeof v !== 'number') {
      this.codes.add('FIELD_TYPE');
      return undefined;
    }
    if (!isIntegral(v)) {
      // A non-integral or non-finite number is the right type with a wrong value.
      this.codes.add('FIELD_VALUE');
      return undefined;
    }
    if (v < min || v > max) {
      this.codes.add('FIELD_VALUE');
      return undefined;
    }
    return v;
  }

  arr(v: Json): Json[] | undefined {
    if (!Array.isArray(v)) {
      this.codes.add('FIELD_TYPE');
      return undefined;
    }
    return v;
  }

  obj(v: Json): Obj | undefined {
    if (!isObj(v)) {
      this.codes.add('FIELD_TYPE');
      return undefined;
    }
    return v;
  }
}

function idNumber(prefix: string, id: string): number | undefined {
  const m = new RegExp(`^${prefix}_([1-9][0-9]{0,8})$`).exec(id);
  return m === null ? undefined : Number(m[1]);
}

function checkId(c: Check, v: Json, prefix: string): string | undefined {
  const s = c.str(v, 1, 40);
  if (s === undefined) return undefined;
  if (idNumber(prefix, s) === undefined) {
    c.codes.add('FIELD_VALUE');
    return undefined;
  }
  return s;
}

function checkTimestamp(c: Check, v: Json): string | undefined {
  const s = c.str(v, 0, 64);
  if (s === undefined) return undefined;
  if (!TS_RE.test(s)) {
    c.codes.add('FIELD_VALUE');
    return undefined;
  }
  return s;
}

interface SourceResult {
  ok: boolean;
  source?: Source;
  rawId?: string;
}

function checkSource(c: Check, v: Json): SourceResult {
  const o = c.obj(v);
  if (o === undefined) return { ok: false };
  let ok = c.keys(o, [
    'id', 'title', 'author', 'date', 'provenance', 'url', 'rights', 'origin', 'text',
    'contentHash', 'createdAt',
  ]);
  const rawId = typeof o['id'] === 'string' ? o['id'] : undefined;
  const id = 'id' in o ? checkId(c, o['id'], 's') : undefined;
  const title = 'title' in o ? c.str(o['title'], 1, 200) : undefined;
  const author = 'author' in o ? c.str(o['author'], 0, 200) : undefined;
  let date: string | undefined;
  if ('date' in o) {
    date = c.str(o['date'], 0, 10);
    if (date !== undefined && date !== '' && !isRealDate(date)) {
      c.codes.add('FIELD_VALUE');
      date = undefined;
    }
  }
  const provenance = 'provenance' in o ? c.str(o['provenance'], 0, 1000) : undefined;
  let url: string | undefined;
  if ('url' in o) {
    url = c.str(o['url'], 0, 2000);
    if (url !== undefined && url !== '' && !/^https?:\/\//.test(url)) {
      c.codes.add('FIELD_VALUE');
      url = undefined;
    }
  }
  const rights = 'rights' in o ? c.str(o['rights'], 0, 1000) : undefined;
  const origin = 'origin' in o ? c.enumStr(o['origin'], SOURCE_ORIGINS) : undefined;
  let text: string | undefined;
  if ('text' in o) {
    const raw = o['text'];
    if (typeof raw !== 'string') {
      c.codes.add('FIELD_TYPE');
    } else {
      const problems = textProblems(raw);
      for (const p of problems) c.codes.add(p);
      if (problems.length === 0) text = raw;
    }
  }
  const hash = 'contentHash' in o ? c.str(o['contentHash'], 0, 64) : undefined;
  if (hash !== undefined && !HASH_RE.test(hash)) c.codes.add('FIELD_VALUE');
  const createdAt = 'createdAt' in o ? checkTimestamp(c, o['createdAt']) : undefined;
  if (text !== undefined && hash !== undefined && HASH_RE.test(hash)) {
    if (contentHash(text) !== hash) {
      c.codes.add('HASH_MISMATCH');
      ok = false;
    }
  }
  if (
    !ok || id === undefined || title === undefined || author === undefined || date === undefined ||
    provenance === undefined || url === undefined || rights === undefined || origin === undefined ||
    text === undefined || hash === undefined || !HASH_RE.test(hash) || createdAt === undefined
  ) {
    return rawId === undefined ? { ok: false } : { ok: false, rawId };
  }
  return {
    ok: true,
    rawId: id,
    source: { id, title, author, date, provenance, url, rights, origin, text, contentHash: hash, createdAt },
  };
}

function checkLocator(c: Check, v: Json): Claim['evidence'][number]['locator'] | undefined {
  const o = c.obj(v);
  if (o === undefined) return undefined;
  const keysOk = c.keys(o, ['start', 'end', 'text', 'contextHash']);
  const start = 'start' in o ? c.int(o['start'], 0, MAX_INT) : undefined;
  const end = 'end' in o ? c.int(o['end'], 0, MAX_INT) : undefined;
  const text = 'text' in o ? c.str(o['text'], 0, 5000) : undefined;
  const ctx = 'contextHash' in o ? c.str(o['contextHash'], 0, 64) : undefined;
  if (ctx !== undefined && !HASH_RE.test(ctx)) {
    c.codes.add('FIELD_VALUE');
    return undefined;
  }
  if (!keysOk || start === undefined || end === undefined || text === undefined || ctx === undefined) {
    return undefined;
  }
  return { start, end, text, contextHash: ctx };
}

function checkEvidence(c: Check, v: Json): Claim['evidence'][number] | undefined {
  const o = c.obj(v);
  if (o === undefined) return undefined;
  const keysOk = c.keys(o, ['id', 'sourceId', 'locator', 'label', 'note']);
  const id = 'id' in o ? checkId(c, o['id'], 'e') : undefined;
  const sourceId = 'sourceId' in o ? checkId(c, o['sourceId'], 's') : undefined;
  const locator = 'locator' in o ? checkLocator(c, o['locator']) : undefined;
  const label = 'label' in o ? c.enumStr(o['label'], LABELS) : undefined;
  const note = 'note' in o ? c.str(o['note'], 0, 1000) : undefined;
  if (!keysOk || id === undefined || sourceId === undefined || locator === undefined ||
    label === undefined || note === undefined) {
    return undefined;
  }
  return { id, sourceId, locator, label, note };
}

function checkAudit(c: Check, v: Json, index: number): Claim['audit'][number] | undefined {
  const o = c.obj(v);
  if (o === undefined) return undefined;
  const typeRaw = o['type'];
  const known = typeof typeRaw === 'string' && (AUDIT_TYPES as readonly string[]).includes(typeRaw);
  const isTransition = known && typeRaw === 'transition';
  const isRefusal = known && typeRaw === 'approval_refused';
  const optional = isTransition ? ['from', 'to'] : isRefusal ? ['codes'] : [];
  const required = ['seq', 'at', 'actor', 'type', 'note', ...optional];
  const keysOk = c.keys(o, required);
  let ok = keysOk;
  const seq = 'seq' in o ? c.int(o['seq'], 0, MAX_INT) : undefined;
  if (seq !== undefined && seq !== index + 1) {
    c.codes.add('AUDIT_SEQ');
    ok = false;
  }
  const at = 'at' in o ? checkTimestamp(c, o['at']) : undefined;
  let actor: 'user' | undefined;
  if ('actor' in o) {
    const a = c.str(o['actor'], 0, 64);
    if (a !== undefined) {
      if (a !== 'user') {
        c.codes.add('AUDIT_ACTOR_INVALID');
        ok = false;
      } else {
        actor = 'user';
      }
    }
  }
  let type: (typeof AUDIT_TYPES)[number] | undefined;
  if ('type' in o) {
    const t = c.str(typeRaw, 0, 64);
    if (t !== undefined) {
      if (!known) {
        c.codes.add('AUDIT_TYPE_INVALID');
        ok = false;
      } else {
        type = t as (typeof AUDIT_TYPES)[number];
      }
    }
  }
  const note = 'note' in o ? c.str(o['note'], 0, 1000) : undefined;
  let from: (typeof STATUSES)[number] | undefined;
  let to: (typeof STATUSES)[number] | undefined;
  let codes: (typeof BLOCKER_CODES)[number][] | undefined;
  if (isTransition) {
    if ('from' in o) from = c.enumStr(o['from'], STATUSES);
    if ('to' in o) to = c.enumStr(o['to'], STATUSES);
    if (from === undefined || to === undefined) ok = false;
  }
  if (isRefusal && 'codes' in o) {
    const raw = c.arr(o['codes']);
    if (raw === undefined) {
      ok = false;
    } else {
      const strings: string[] = [];
      let allStrings = true;
      for (const item of raw) {
        const s = c.str(item, 0, 64);
        if (s === undefined) allStrings = false;
        else strings.push(s);
      }
      if (!allStrings) {
        ok = false;
      } else {
        let bad = strings.length === 0;
        for (let i = 0; i < strings.length; i += 1) {
          const cur = strings[i] as string;
          if (!(BLOCKER_CODES as readonly string[]).includes(cur)) bad = true;
          if (i > 0 && !((strings[i - 1] as string) < cur)) bad = true;
        }
        if (bad) {
          c.codes.add('AUDIT_REFUSAL_CODES');
          ok = false;
        } else {
          codes = strings as (typeof BLOCKER_CODES)[number][];
        }
      }
    }
  }
  if (!ok || seq === undefined || at === undefined || actor === undefined || type === undefined ||
    note === undefined) {
    return undefined;
  }
  const event: Claim['audit'][number] = { seq, at, actor, type, note };
  if (from !== undefined) event.from = from;
  if (to !== undefined) event.to = to;
  if (codes !== undefined) event.codes = codes;
  return event;
}

interface ClaimResult {
  ok: boolean;
  claim?: Claim;
  evidenceIds: string[];
}

function checkClaim(c: Check, v: Json): ClaimResult {
  const o = c.obj(v);
  if (o === undefined) return { ok: false, evidenceIds: [] };
  let ok = c.keys(o, [
    'id', 'text', 'kind', 'status', 'evidence', 'reviewNote', 'audit', 'origin', 'createdAt', 'updatedAt',
  ]);
  const id = 'id' in o ? checkId(c, o['id'], 'c') : undefined;
  const text = 'text' in o ? c.str(o['text'], 0, 2000) : undefined;
  const kind = 'kind' in o ? c.enumStr(o['kind'], KINDS) : undefined;
  const status = 'status' in o ? c.enumStr(o['status'], STATUSES) : undefined;
  const reviewNote = 'reviewNote' in o ? c.str(o['reviewNote'], 0, 2000) : undefined;
  const origin = 'origin' in o ? c.enumStr(o['origin'], CLAIM_ORIGINS) : undefined;
  const createdAt = 'createdAt' in o ? checkTimestamp(c, o['createdAt']) : undefined;
  const updatedAt = 'updatedAt' in o ? checkTimestamp(c, o['updatedAt']) : undefined;

  const evidence: Claim['evidence'] = [];
  const evidenceIds: string[] = [];
  if ('evidence' in o) {
    const raw = c.arr(o['evidence']);
    if (raw === undefined) {
      ok = false;
    } else {
      if (raw.length > LIMITS.evidencePerClaim) c.codes.add('LIMIT_EXCEEDED');
      for (const item of raw) {
        if (isObj(item) && typeof item['id'] === 'string') evidenceIds.push(item['id']);
        const ev = checkEvidence(c, item);
        if (ev === undefined) ok = false;
        else evidence.push(ev);
      }
    }
  }

  const audit: Claim['audit'] = [];
  if ('audit' in o) {
    const raw = c.arr(o['audit']);
    if (raw === undefined) {
      ok = false;
    } else {
      if (raw.length > LIMITS.auditPerClaim) c.codes.add('LIMIT_EXCEEDED');
      let previousAt: string | undefined;
      raw.forEach((item, index) => {
        const ev = checkAudit(c, item, index);
        if (ev === undefined) {
          ok = false;
          // An event can be only partly valid; still compare the timestamps we can trust.
          if (isObj(item) && typeof item['at'] === 'string' && TS_RE.test(item['at'])) {
            if (previousAt !== undefined && item['at'] < previousAt) c.codes.add('AUDIT_TIME');
            previousAt = item['at'];
          }
          return;
        }
        if (previousAt !== undefined && ev.at < previousAt) {
          c.codes.add('AUDIT_TIME');
          ok = false;
        }
        previousAt = ev.at;
        audit.push(ev);
      });
    }
  }

  if (
    !ok || id === undefined || text === undefined || kind === undefined || status === undefined ||
    reviewNote === undefined || origin === undefined || createdAt === undefined ||
    updatedAt === undefined
  ) {
    return { ok: false, evidenceIds };
  }
  return {
    ok: true,
    claim: { id, text, kind, status, evidence, reviewNote, audit, origin, createdAt, updatedAt },
    evidenceIds,
  };
}

/** Spec 03 §1. Returns the sorted list of unique codes; empty means valid. */
export function validateWorkspace(value: unknown): string[] {
  if (!isObj(value)) return ['NOT_OBJECT'];
  const schema = value['schema'];
  if (!isIntegral(schema) || schema !== 1) return ['SCHEMA_VERSION'];
  const c = new Check();
  c.keys(value, ['schema', 'name', 'counters', 'sources', 'claims']);
  if ('name' in value) c.str(value['name'], 1, 120);

  let counters: { source: number; claim: number; evidence: number } | undefined;
  if ('counters' in value) {
    const co = c.obj(value['counters']);
    if (co !== undefined) {
      const keysOk = c.keys(co, ['source', 'claim', 'evidence']);
      const s = 'source' in co ? c.int(co['source'], 0, MAX_INT) : undefined;
      const cl = 'claim' in co ? c.int(co['claim'], 0, MAX_INT) : undefined;
      const e = 'evidence' in co ? c.int(co['evidence'], 0, MAX_INT) : undefined;
      if (keysOk && s !== undefined && cl !== undefined && e !== undefined) {
        counters = { source: s, claim: cl, evidence: e };
      }
    }
  }

  const sourceRaw = 'sources' in value ? c.arr(value['sources']) : undefined;
  const claimRaw = 'claims' in value ? c.arr(value['claims']) : undefined;
  if (sourceRaw !== undefined && sourceRaw.length > LIMITS.sources) c.codes.add('LIMIT_EXCEEDED');
  if (claimRaw !== undefined && claimRaw.length > LIMITS.claims) c.codes.add('LIMIT_EXCEEDED');

  const goodSources = new Map<string, Source>();
  const sourceIds = new Set<string>();
  const hashes = new Set<string>();
  let maxSource = 0;
  for (const item of sourceRaw ?? []) {
    const r = checkSource(c, item);
    if (r.rawId !== undefined) {
      if (sourceIds.has(r.rawId)) c.codes.add('DUPLICATE_ID');
      sourceIds.add(r.rawId);
      maxSource = Math.max(maxSource, idNumber('s', r.rawId) ?? 0);
    }
    if (r.ok && r.source !== undefined) {
      if (hashes.has(r.source.contentHash)) c.codes.add('DUPLICATE_SOURCE_HASH');
      hashes.add(r.source.contentHash);
      if (!goodSources.has(r.source.id)) goodSources.set(r.source.id, r.source);
    }
  }

  const claimIds = new Set<string>();
  const evidenceIds = new Set<string>();
  let maxClaim = 0;
  let maxEvidence = 0;
  for (const item of claimRaw ?? []) {
    if (isObj(item) && typeof item['id'] === 'string') {
      if (claimIds.has(item['id'])) c.codes.add('DUPLICATE_ID');
      claimIds.add(item['id']);
      maxClaim = Math.max(maxClaim, idNumber('c', item['id']) ?? 0);
    }
    const r = checkClaim(c, item);
    for (const eid of r.evidenceIds) {
      if (evidenceIds.has(eid)) c.codes.add('DUPLICATE_ID');
      evidenceIds.add(eid);
      maxEvidence = Math.max(maxEvidence, idNumber('e', eid) ?? 0);
    }
    if (!r.ok || r.claim === undefined) continue;
    const claim = r.claim;
    for (const ev of claim.evidence) {
      if (!sourceIds.has(ev.sourceId)) {
        c.codes.add('EVIDENCE_SOURCE_MISSING');
        continue;
      }
      const src = goodSources.get(ev.sourceId);
      if (src !== undefined && verifyLocator(src.text, ev.locator) !== 'OK') {
        c.codes.add('LOCATOR_INVALID');
      }
    }
    // Replay the audit trail.
    let status: (typeof STATUSES)[number] = 'draft';
    for (const ev of claim.audit) {
      if (ev.type !== 'transition' || ev.from === undefined || ev.to === undefined) continue;
      if (!canTransition(ev.from, ev.to)) c.codes.add('AUDIT_TRANSITION_INVALID');
      if (ev.from !== status) c.codes.add('AUDIT_STATUS_MISMATCH');
      status = ev.to;
    }
    if (status !== claim.status) c.codes.add('AUDIT_STATUS_MISMATCH');
    if (claim.status === 'approved' && approvalBlockers(claim, goodSources).length > 0) {
      c.codes.add('APPROVED_FAILS_GATE');
    }
  }

  if (counters !== undefined) {
    if (counters.source < maxSource || counters.claim < maxClaim || counters.evidence < maxEvidence) {
      c.codes.add('COUNTER_INVALID');
    }
  }
  return [...c.codes].sort();
}

/** Spec 03 §1 `parseWorkspaceJson`. */
export function parseWorkspaceJson(
  text: string,
  maxBytes: number = LIMITS.jsonBytes,
): { ok: true; workspace: Workspace } | { ok: false; codes: string[] } {
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, codes: ['JSON_TOO_LARGE'] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, codes: ['JSON_INVALID'] };
  }
  const codes = validateWorkspace(value);
  if (codes.length > 0) return { ok: false, codes };
  return { ok: true, workspace: value as Workspace };
}
