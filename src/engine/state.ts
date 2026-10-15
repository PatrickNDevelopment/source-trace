/** Spec 02 §1: the transition table, and §2 the approval gate. */
import { verifyLocator } from './locator';
import { isBlank } from './text';
import type { BlockerCode, Claim, Source, Status } from './types';

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  draft: ['needs_review'],
  needs_review: ['approved', 'rejected', 'revise'],
  approved: ['revise'],
  rejected: ['draft'],
  revise: ['needs_review'],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Claim content (text, kind, evidence) is editable only here. */
export function isContentEditable(status: Status): boolean {
  return status === 'draft' || status === 'revise';
}

/** Spec 02 §2: sorted, unique blocker codes; empty means the claim may be approved. */
export function approvalBlockers(
  claim: Pick<Claim, 'text' | 'kind' | 'evidence'>,
  sources: ReadonlyMap<string, Pick<Source, 'text'>>,
): BlockerCode[] {
  const out = new Set<BlockerCode>();
  if (isBlank(claim.text)) out.add('CLAIM_TEXT_EMPTY');
  if (claim.evidence.length === 0) out.add('NO_EVIDENCE');
  let validSupport = 0;
  for (const ev of claim.evidence) {
    const source = sources.get(ev.sourceId);
    if (source === undefined) {
      out.add('EVIDENCE_SOURCE_MISSING');
    } else if (verifyLocator(source.text, ev.locator) !== 'OK') {
      out.add('EVIDENCE_LOCATOR_INVALID');
    } else if (ev.label === 'support') {
      validSupport += 1;
    }
    if (ev.label === 'contradiction' && claim.kind !== 'disputed') {
      out.add('CONTRADICTION_PRESENT');
    }
  }
  if (claim.evidence.length > 0 && validSupport === 0) out.add('NO_SUPPORT');
  return [...out].sort();
}
