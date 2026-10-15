import { useState, type ReactNode } from 'react';
import { clearWorkspace } from '../lib/storage';
import { newWorkspace } from '../engine';
import { useApp } from './common';

export function SettingsView(): ReactNode {
  const app = useApp();
  const { backend } = app;
  const [url, setUrl] = useState(backend.url);
  const [confirmReset, setConfirmReset] = useState(false);

  const online = backend.status === 'online';

  return (
    <div className="stack">
      <section className="card" aria-labelledby="be-h">
        <h2 id="be-h">Local backend (optional)</h2>
        <p className="help">
          The static demo is fully usable without it. The backend adds: PDF text extraction, saving
          the workspace to a local SQLite database, and an optional AI assistant. It runs on your
          own machine (<code>python -m source_trace</code>) and nothing is contacted until you press
          Connect.
        </p>
        <p data-testid="backend-status">
          Status:{' '}
          <strong>
            {backend.status === 'off' && 'not connected (local-data mode)'}
            {backend.status === 'connecting' && 'connecting…'}
            {backend.status === 'online' && `connected, version ${backend.caps?.version}`}
            {backend.status === 'offline' && 'unreachable'}
          </strong>
        </p>
        {backend.error ? (
          <p className="banner banner-error" role="alert">
            {backend.error} Local-data mode keeps working.
          </p>
        ) : null}
        <label>
          Backend address
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </label>
        <div className="row">
          <button type="button" className="primary" onClick={() => void backend.connect(url)}>
            Use the backend
          </button>
          <button type="button" onClick={backend.disconnect} disabled={!backend.enabled}>
            Disconnect
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="sv-h">
        <h2 id="sv-h">Save to the backend</h2>
        <p className="help">
          Snapshots are re-validated by the backend with the same state-machine and approval rules.
          A snapshot with an approved claim that fails them is refused.
          {backend.revision !== null ? ` Last known revision: ${backend.revision}.` : ''}
        </p>
        <div className="row">
          <button type="button" disabled={!online} onClick={() => void backend.saveToBackend()}>
            Save workspace to backend
          </button>
          <button type="button" disabled={!online} onClick={() => void backend.loadFromBackend()}>
            Load workspace from backend
          </button>
        </div>
        {!online ? <p className="help">Connect the backend first.</p> : null}
      </section>

      <section className="card" aria-labelledby="ai-h2">
        <h2 id="ai-h2">AI assistant</h2>
        {online && backend.caps?.ai.enabled ? (
          <>
            <p>
              Provider: <strong>{backend.caps.ai.provider}</strong>, model{' '}
              <strong>{backend.caps.ai.model}</strong>. Limit: {backend.caps.ai.limits.callsPerHour}{' '}
              calls per hour. Opt-in is per session: reloading the page turns it off again.
            </p>
            <label className="inline">
              <input
                type="checkbox"
                checked={backend.aiOptIn}
                onChange={(e) => backend.setAiOptIn(e.target.checked)}
              />
              Allow AI suggestions in this session
            </label>
          </>
        ) : (
          <p data-testid="ai-settings-disabled">
            Disabled. The assistant is off unless a backend is connected <em>and</em> configured
            with a provider (server-side environment only; keys never reach this page).
          </p>
        )}
        <p className="help">
          Suggestions can only cite passages that exist in the text you send, cannot change any
          status, and are never described as verification.
        </p>
      </section>

      <section className="card" aria-labelledby="rs-h">
        <h2 id="rs-h">Browser data</h2>
        <p className="help">
          The workspace is stored in this browser only (localStorage). Export a backup from the
          Report page before clearing it.
        </p>
        {confirmReset ? (
          <div className="row" role="group" aria-label="Confirm clearing browser data">
            <span>Clear the workspace stored in this browser?</span>
            <button
              type="button"
              className="danger"
              onClick={() => {
                clearWorkspace();
                app.replaceWorkspace(
                  newWorkspace('My workspace'),
                  'Cleared the workspace in this browser.',
                );
                setConfirmReset(false);
              }}
            >
              Yes, clear it
            </button>
            <button type="button" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)}>
            Clear workspace in this browser
          </button>
        )}
      </section>
    </div>
  );
}
