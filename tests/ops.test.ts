import { describe, expect, it } from 'vitest';
import {
  acceptSuggestion,
  addEvidence,
  createClaim,
  editClaim,
  importSource,
  newWorkspace,
  removeEvidence,
  setEvidenceLabel,
  setReviewNote,
  transitionClaim,
  validateWorkspace,
  type Workspace,
} from '../src/engine';

const T = (n: number): string => new Date(Date.UTC(2026, 9, 15, 12, 0, n)).toISOString();

function base(): { ws: Workspace; sid: string; cid: string } {
  let ws = newWorkspace('Test');
  const s = importSource(
    ws,
    {
      title: 'Bridge',
      origin: 'paste',
      rawText: 'The bridge opened in 1932.\r\nCritics disliked it.',
    },
    T(1),
  );
  if (!s.ok) throw new Error('source');
  ws = s.workspace;
  const c = createClaim(ws, { text: 'The bridge opened in 1932.', kind: 'factual' }, T(2));
  if (!c.ok) throw new Error('claim');
  return { ws: c.workspace, sid: s.value, cid: c.value };
}

describe('import', () => {
  it('normalizes line endings and de-duplicates by hash', () => {
    const { ws } = base();
    expect(ws.sources[0]?.text).toBe('The bridge opened in 1932.\nCritics disliked it.');
    const again = importSource(
      ws,
      {
        title: 'Copy',
        origin: 'file',
        rawText: 'The bridge opened in 1932.\nCritics disliked it.',
      },
      T(3),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('DUPLICATE_SOURCE');
      expect(again.existingSourceId).toBe('s_1');
    }
  });
  it('refuses blank text and a missing title', () => {
    const ws = newWorkspace();
    const blank = importSource(ws, { title: 'x', origin: 'paste', rawText: ' \n ' }, T(1));
    expect(blank.ok).toBe(false);
    const noTitle = importSource(ws, { title: ' ', origin: 'paste', rawText: 'abc' }, T(1));
    expect(noTitle.ok).toBe(false);
  });
});

describe('approval gate and audit', () => {
  it('refuses to approve an unsupported claim, records the attempt and keeps the status', () => {
    const { ws, cid } = base();
    const review = transitionClaim(ws, cid, 'needs_review', '', T(3));
    if (!review.ok) throw new Error('review');
    const refused = transitionClaim(review.workspace, cid, 'approved', 'try', T(4));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('APPROVAL_REFUSED');
    expect(refused.blockers).toEqual(['NO_EVIDENCE']);
    const claim = refused.workspace.claims[0];
    expect(claim?.status).toBe('needs_review');
    expect(claim?.audit.at(-1)).toMatchObject({
      type: 'approval_refused',
      codes: ['NO_EVIDENCE'],
      note: 'try',
    });
    expect(validateWorkspace(refused.workspace)).toEqual([]);
  });

  it('approves a supported claim only after a user transition, and locks content afterwards', () => {
    const { ws, sid, cid } = base();
    const ev = addEvidence(ws, cid, { sourceId: sid, start: 0, end: 26, label: 'support' }, T(3));
    if (!ev.ok) throw new Error('ev');
    const r1 = transitionClaim(ev.workspace, cid, 'needs_review', '', T(4));
    if (!r1.ok) throw new Error('r1');
    const r2 = transitionClaim(r1.workspace, cid, 'approved', 'checked', T(5));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.workspace.claims[0]?.status).toBe('approved');
    expect(editClaim(r2.workspace, cid, { text: 'changed' }, T(6)).ok).toBe(false);
    const ev2 = addEvidence(
      r2.workspace,
      cid,
      { sourceId: sid, start: 0, end: 3, label: 'support' },
      T(6),
    );
    expect(ev2.ok).toBe(false);
    expect(validateWorkspace(r2.workspace)).toEqual([]);
  });

  it('contradicting evidence blocks a factual claim but not a disputed one', () => {
    const { ws, sid, cid } = base();
    let cur = ws;
    for (const label of ['support', 'contradiction'] as const) {
      const r = addEvidence(cur, cid, { sourceId: sid, start: 0, end: 10, label }, T(3));
      if (!r.ok) throw new Error('ev');
      cur = r.workspace;
    }
    const r1 = transitionClaim(cur, cid, 'needs_review', '', T(4));
    if (!r1.ok) throw new Error('r1');
    const blocked = transitionClaim(r1.workspace, cid, 'approved', '', T(5));
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.blockers).toEqual(['CONTRADICTION_PRESENT']);
    const rev = transitionClaim(blocked.workspace, cid, 'revise', 'reclassify', T(6));
    if (!rev.ok) throw new Error('rev');
    const kind = editClaim(rev.workspace, cid, { kind: 'disputed' }, T(7));
    if (!kind.ok) throw new Error('kind');
    const again = transitionClaim(kind.workspace, cid, 'needs_review', '', T(8));
    if (!again.ok) throw new Error('again');
    expect(transitionClaim(again.workspace, cid, 'approved', '', T(9)).ok).toBe(true);
  });

  it('rejects illegal transitions without touching the workspace', () => {
    const { ws, cid } = base();
    const r = transitionClaim(ws, cid, 'approved', '', T(3));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ILLEGAL_TRANSITION');
      expect(r.workspace).toBe(ws);
    }
  });

  it('keeps timestamps monotonic even if the clock goes backwards', () => {
    const { ws, cid } = base();
    const r = setReviewNote(ws, cid, 'later', T(30));
    if (!r.ok) throw new Error('note');
    const back = setReviewNote(r.workspace, cid, 'earlier clock', T(5));
    if (!back.ok) throw new Error('back');
    expect(validateWorkspace(back.workspace)).toEqual([]);
  });
});

describe('accepting an AI suggestion', () => {
  it('creates a draft claim marked as ai_suggestion and never a status change', () => {
    const { ws, sid } = base();
    const r = acceptSuggestion(
      ws,
      {
        claimText: 'Critics disliked it.',
        kind: 'interpretation',
        sourceId: sid,
        start: 27,
        end: 47,
        text: 'Critics disliked it.',
        label: 'support',
      },
      T(3),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const claim = r.workspace.claims.at(-1);
    expect(claim?.status).toBe('draft');
    expect(claim?.origin).toBe('ai_suggestion');
    expect(validateWorkspace(r.workspace)).toEqual([]);
  });
  it('refuses a suggestion whose passage does not match the source', () => {
    const { ws, sid } = base();
    const wrong = acceptSuggestion(
      ws,
      {
        claimText: 'x',
        kind: 'factual',
        sourceId: sid,
        start: 0,
        end: 5,
        text: 'WRONG',
        label: 'support',
      },
      T(3),
    );
    expect(wrong.ok).toBe(false);
    const missing = acceptSuggestion(
      ws,
      {
        claimText: 'x',
        kind: 'factual',
        sourceId: 's_99',
        start: 0,
        end: 5,
        text: 'The b',
        label: 'support',
      },
      T(3),
    );
    expect(missing.ok).toBe(false);
  });
});

describe('random operation sequences', () => {
  it('always leave a workspace that validates', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const texts = [
      'alpha beta gamma delta',
      'one \ud83d\ude00 two 日本語 three',
      'x\r\ny\rz',
      'Quote "alpha beta" here 1999',
    ];
    const kinds = ['factual', 'disputed', 'interpretation'] as const;
    const labels = ['support', 'contradiction', 'unknown'] as const;
    const statuses = ['needs_review', 'approved', 'rejected', 'revise', 'draft'] as const;
    for (let run = 0; run < 25; run += 1) {
      let ws = newWorkspace('Random');
      let clock = 0;
      const at = (): string => T((clock += 1));
      for (let step = 0; step < 60; step += 1) {
        const choice = rnd(8);
        const claim = ws.claims[rnd(Math.max(1, ws.claims.length))];
        const source = ws.sources[rnd(Math.max(1, ws.sources.length))];
        let r;
        if (choice === 0) {
          r = importSource(
            ws,
            { title: `S${step}`, origin: 'paste', rawText: `${texts[rnd(4)]} ${step}` },
            at(),
          );
        } else if (choice === 1) {
          r = createClaim(
            ws,
            { text: `claim ${rnd(3)} alpha`, kind: kinds[rnd(3)] ?? 'factual' },
            at(),
          );
        } else if (choice === 2 && claim && source) {
          const a = rnd(source.text.length);
          r = addEvidence(
            ws,
            claim.id,
            {
              sourceId: source.id,
              start: a,
              end: a + 1 + rnd(8),
              label: labels[rnd(3)] ?? 'support',
            },
            at(),
          );
        } else if (choice === 3 && claim) {
          r = transitionClaim(ws, claim.id, statuses[rnd(5)] ?? 'draft', '', at());
        } else if (choice === 4 && claim?.evidence[0]) {
          r = removeEvidence(ws, claim.id, claim.evidence[0].id, at());
        } else if (choice === 5 && claim?.evidence[0]) {
          r = setEvidenceLabel(ws, claim.id, claim.evidence[0].id, 'contradiction', at());
        } else if (choice === 6 && claim) {
          r = editClaim(ws, claim.id, { text: `edited ${step}` }, at());
        } else if (claim) {
          r = setReviewNote(ws, claim.id, `note ${step}`, at());
        }
        if (r) ws = r.workspace;
        expect(validateWorkspace(ws)).toEqual([]);
      }
    }
  });
});

describe('reviewer regressions', () => {
  it('stops appending at the 500-event audit limit, so the workspace stays valid', () => {
    const { ws: w0, cid } = base();
    const sent = transitionClaim(w0, cid, 'needs_review', '', T(3));
    if (!sent.ok) throw new Error('send');
    let ws = sent.workspace;
    // Pressing "Approve" again and again on an unsupported claim records each refusal...
    for (let i = 0; i < 520; i += 1) ws = transitionClaim(ws, cid, 'approved', '', T(4)).workspace;
    const claim = ws.claims.find((c) => c.id === cid);
    // ...but never more than the 500 events a valid workspace may hold.
    expect(claim?.audit).toHaveLength(500);
    expect(validateWorkspace(ws)).toEqual([]);
    const blocked = transitionClaim(ws, cid, 'approved', '', T(5));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('AUDIT_FULL');
      expect(blocked.workspace).toBe(ws);
    }
    for (const r of [
      setReviewNote(ws, cid, 'note', T(5)),
      transitionClaim(ws, cid, 'revise', '', T(5)),
    ]) {
      expect(r.ok).toBe(false);
      expect(r.workspace).toBe(ws);
    }
  });

  it('refuses NUL and lone surrogates that would make the workspace invalid', () => {
    const { ws, sid, cid } = base();
    const nul = 'a\u0000b';
    const lone = `a${String.fromCharCode(0xd800)}b`;
    expect(createClaim(ws, { text: nul, kind: 'factual' }, T(3)).ok).toBe(false);
    expect(createClaim(ws, { text: lone, kind: 'factual' }, T(3)).ok).toBe(false);
    expect(editClaim(ws, cid, { text: nul }, T(3)).ok).toBe(false);
    expect(setReviewNote(ws, cid, nul, T(3)).ok).toBe(false);
    expect(transitionClaim(ws, cid, 'needs_review', nul, T(3)).ok).toBe(false);
    expect(
      addEvidence(ws, cid, { sourceId: sid, start: 0, end: 3, label: 'support', note: nul }, T(3))
        .ok,
    ).toBe(false);
    expect(importSource(ws, { title: nul, origin: 'paste', rawText: 'other' }, T(3)).ok).toBe(
      false,
    );
    const ai = acceptSuggestion(
      ws,
      {
        claimText: nul,
        kind: 'factual',
        sourceId: sid,
        start: 0,
        end: 3,
        text: 'The',
        label: 'support',
      },
      T(3),
    );
    expect(ai.ok).toBe(false);
    expect(ai.workspace).toBe(ws);
  });
});
