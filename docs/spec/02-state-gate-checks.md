# Spec 02: state machine, approval gate, heuristic checks

## 1. State machine (shared contract)

Statuses: `draft`, `needs_review`, `approved`, `rejected`, `revise`. A new claim starts as `draft`.

Transition table (`from` to the listed `to` values; anything else is illegal):

| from           | allowed to                       |
| -------------- | -------------------------------- |
| `draft`        | `needs_review`                   |
| `needs_review` | `approved`, `rejected`, `revise` |
| `approved`     | `revise`                         |
| `rejected`     | `draft`                          |
| `revise`       | `needs_review`                   |

Rules:

- Only the user's explicit action performs a transition. No code path derives a transition from a
  check result or an AI suggestion.
- `needs_review` to `approved` is additionally subject to the gate (section 2).
- Claim content (text, kind, evidence) is editable only in `draft` and `revise`. Review notes can be
  edited in any status.
- Every transition appends an audit event. A refused approval appends an `approval_refused` event and
  does not change the status.

## 2. Approval gate (shared contract)

`approvalBlockers(claim, sources)` returns a sorted list of unique blocker codes. Empty means the claim
may be approved. `sources` maps source id to source.

| Code                       | Condition                                                                  |
| -------------------------- | -------------------------------------------------------------------------- |
| `CLAIM_TEXT_EMPTY`         | `isBlank(claim.text)`                                                      |
| `NO_EVIDENCE`              | the claim has no evidence                                                  |
| `NO_SUPPORT`               | evidence exists and none has label `support` **and** `verifyLocator == OK` |
| `EVIDENCE_SOURCE_MISSING`  | some evidence references a source id not present                           |
| `EVIDENCE_LOCATOR_INVALID` | some evidence whose source exists has `verifyLocator != OK`                |
| `CONTRADICTION_PRESENT`    | some evidence has label `contradiction` and `claim.kind != "disputed"`     |

Sorting is plain ascending code-unit order of the code strings. The same codes appear in
`approval_refused` audit events (`codes`) and in UI warnings, with these human messages (UI only):

- `NO_EVIDENCE`: "This claim cites no source passage."
- `NO_SUPPORT`: "No cited passage is labelled as supporting this claim (and valid)."
- `CONTRADICTION_PRESENT`: "Contradicting evidence is attached; only a claim of kind 'disputed assertion' can be approved with it."
- `EVIDENCE_LOCATOR_INVALID`: "A cited passage no longer matches its source text."

The gate says that the **review preconditions** hold. It is not a statement that the claim is true.

## 3. Heuristic checks (TypeScript only, advisory, never blocking)

All results are labelled `heuristic`. They flag; they do not prove or disprove anything.
`runChecks(workspace)` returns findings `{ code, severity, claimId, evidenceId?, message }` sorted by
claim id, then code, then evidence id.

| Code                    | Severity | Definition                                                                                                                                                            |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISSING_SOURCE`        | warning  | claim has no evidence                                                                                                                                                 |
| `UNSUPPORTED_CLAIM`     | warning  | evidence exists but none is a valid `support`                                                                                                                         |
| `MISMATCHED_CITATION`   | warning  | evidence with `verifyLocator != OK`, or source missing                                                                                                                |
| `QUOTE_NOT_IN_PASSAGE`  | warning  | a quoted span in the claim (between `"` and `"`, or `“` and `”`, 3 to 300 code points) does not occur, after collapsing blank runs to one space, in any cited passage |
| `DATE_NOT_IN_PASSAGE`   | warning  | a year (`\b(1[0-9]{3}\|20[0-9]{2})\b`) or ISO date (`YYYY-MM-DD`) in the claim text occurs in no cited passage (a year inside an ISO date is part of that date)       |
| `SOURCE_DATE_MISSING`   | info     | a cited source has no date                                                                                                                                            |
| `DUPLICATE_CLAIM`       | warning  | another claim has the same _comparison form_, or token Jaccard similarity >= 0.8                                                                                      |
| `CONTRADICTION_PRESENT` | info     | some evidence is labelled `contradiction`                                                                                                                             |

_Comparison form_: Unicode lower-cased, every run of characters that are not letters or digits
replaced by one space, trimmed. Tokens are the space-separated pieces; Jaccard = |A ∩ B| / |A ∪ B| on
token sets; two empty claims are not duplicates of each other.
