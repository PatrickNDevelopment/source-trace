import type { ReactNode } from 'react';

export function AboutView(): ReactNode {
  return (
    <div className="stack">
      <section className="card prose">
        <h2>What SourceTrace is</h2>
        <p>
          A workbench for reviewing claims against the exact passages that are said to support them.
          You import source texts, write claims, attach exact passages with their positions, label
          each passage as supporting, contradicting or unknown, and move each claim through a review
          process that only a person can drive. Everything leaves a record.
        </p>
        <h2>What it does not do</h2>
        <ul>
          <li>It does not verify that anything is true, historically accurate or complete.</li>
          <li>
            Its checks are <strong>heuristics</strong>: they flag missing citations, quotes and
            dates that do not appear in the cited passage, near-duplicate claims and similar. A
            claim with no flags may still be wrong; a flagged claim may be fine.
          </li>
          <li>
            The approval gate only checks review preconditions: there is cited, matching, supporting
            evidence and no unacknowledged contradiction. It is not a truth test.
          </li>
          <li>An optional AI assistant can suggest drafts. It cannot approve, reject or verify.</li>
        </ul>
        <h2>How the review works</h2>
        <ol>
          <li>Draft: write the claim and attach passages.</li>
          <li>Needs review: send it for review (content is then locked).</li>
          <li>
            Approved, rejected or revise: the reviewer decides. Approval is refused, with the
            precise reasons, if the preconditions are not met; the attempt is kept in the audit
            trail.
          </li>
        </ol>
        <h2>Your data</h2>
        <p>
          In this static demo everything stays in your browser. Source URLs are metadata and are
          never fetched. Source text is rendered as plain text; markup inside a source is never
          interpreted.
        </p>
        <h2>Source material</h2>
        <p>
          Use only public domain, licensed, synthetic or your own texts. The bundled sample is
          invented and labelled as such.
        </p>
      </section>
    </div>
  );
}
