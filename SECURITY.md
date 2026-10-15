# Security notes

SourceTrace is a local tool. The static app has no server. The optional backend has **no
authentication** and is for loopback use only.

## Threat model in short

| Input                          | Treated as                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source text (any origin)       | Hostile data. Rendered as plain text (React text nodes, `<textarea>`, `<pre>`); never as HTML or Markdown. The Markdown report puts it in fenced code blocks, so it is never rendered. |
| Imported workspace JSON        | Hostile. Fully validated (schema, hashes, locators, audit trail, gate) before it can replace anything.                                                                                 |
| PDF files                      | Hostile. Header, size and page checks; parsed in a separate `python -I` process killed after a time limit; no JavaScript or embedded files are executed.                               |
| AI provider output             | Hostile data. Strict schema, existing source ids and exact passages only; cannot change state.                                                                                         |
| Browser pages on other origins | Cannot write to the backend (Origin check) and cannot read it (CORS allow-list); DNS rebinding is refused by the Host allow-list.                                                      |

## Controls

Host-header allow-list, strict CORS and write-origin check, request body cap enforced while
streaming (413 even for a streamed JSON body), total request deadline, loopback bind by default, one error envelope (no stack traces),
SQLite busy mapped to 503, secrets only from the server environment, no secret in the repository
(`npm run secrets` scans for common patterns), AI usage log without secrets.

## Reporting

Open a private security advisory on the repository once it is published, or contact the owner.
