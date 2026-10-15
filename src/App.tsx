import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { validateWorkspace, type OpResult, type Workspace } from './engine';
import { ApiError, api, type Capabilities } from './lib/api';
import { downloadText } from './lib/files';
import { isSampleWorkspace } from './lib/sample';
import {
  DEFAULT_BACKEND_URL,
  WORKSPACE_KEY,
  loadBackendPrefs,
  loadWorkspace,
  readCorruptCopy,
  saveBackendPrefs,
  saveWorkspace,
  type LoadResult,
} from './lib/storage';
import { AboutView } from './ui/AboutView';
import { ReportView } from './ui/ReportView';
import { ReviewView } from './ui/ReviewView';
import { SettingsView } from './ui/SettingsView';
import { SourcesView } from './ui/SourcesView';
import {
  AppProvider,
  type AppApi,
  type BackendState,
  type NoticeKind,
  type View,
} from './ui/common';

const VIEWS: { id: View; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'review', label: 'Review' },
  { id: 'report', label: 'Report' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
];

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS.find((v) => v.id === h)?.id ?? 'sources') as View;
}

const BACKEND_WORKSPACE_ID = 'default';

export function App(): ReactNode {
  const [initial] = useState<LoadResult>(loadWorkspace);
  const [ws, setWs] = useState<Workspace>(initial.workspace);
  const [view, setView] = useState<View>(viewFromHash());
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedClaimId, setSelectedClaimId] = useState('');
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [storageError, setStorageError] = useState('');
  const [otherTab, setOtherTab] = useState(false);
  const [recovered] = useState(initial.kind === 'recovered' ? initial.codes.join(', ') : '');
  // The latest workspace for event handlers: two operations in one handler must chain.
  const wsRef = useRef<Workspace>(initial.workspace);

  const commitWs = useCallback((next: Workspace): void => {
    wsRef.current = next;
    setWs(next);
    setStorageError(saveWorkspace(next) ?? '');
  }, []);

  // ---- backend ---------------------------------------------------------------------------------
  const [prefs, setPrefs] = useState(loadBackendPrefs);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [status, setStatus] = useState<BackendState['status']>('off');
  const [backendError, setBackendError] = useState('');
  const [revision, setRevision] = useState<number | null>(null);
  const [aiOptIn, setAiOptIn] = useState(false); // per session: never persisted

  const notify = useCallback((kind: NoticeKind, text: string): void => {
    setNotice({ kind, text });
  }, []);

  const probe = useCallback(async (url: string): Promise<void> => {
    setStatus('connecting');
    setBackendError('');
    try {
      const c = await api.capabilities(url);
      setCaps(c);
      setStatus('online');
    } catch (e) {
      setCaps(null);
      setStatus('offline');
      setBackendError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // The static demo never contacts any backend unless the user switched it on earlier.
    if (!prefs.enabled) return undefined;
    const timer = setTimeout(() => void probe(prefs.url), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backend: BackendState = useMemo(
    () => ({
      enabled: prefs.enabled,
      url: prefs.url,
      status,
      caps,
      revision,
      error: backendError,
      aiOptIn,
      setAiOptIn,
      connect: async (url: string): Promise<void> => {
        const next = { enabled: true, url: url.trim() || DEFAULT_BACKEND_URL };
        setPrefs(next);
        saveBackendPrefs(next);
        await probe(next.url);
      },
      disconnect: (): void => {
        const next = { enabled: false, url: prefs.url };
        setPrefs(next);
        saveBackendPrefs(next);
        setCaps(null);
        setStatus('off');
        setBackendError('');
        setRevision(null);
        setAiOptIn(false);
      },
      saveToBackend: async (): Promise<void> => {
        try {
          const r = await api.putWorkspace(
            prefs.url,
            BACKEND_WORKSPACE_ID,
            wsRef.current,
            revision,
          );
          setRevision(r.revision);
          notify('success', `Saved to the backend as revision ${r.revision}.`);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'stale_revision') {
            notify(
              'error',
              'The stored copy changed since you loaded it. Load it again before saving, or export a backup first.',
            );
          } else if (e instanceof ApiError && e.code === 'invalid_workspace') {
            const codes = (e.details?.['codes'] as string[] | undefined) ?? [];
            notify(
              'error',
              `The backend refused this workspace: ${codes.join(', ') || e.message}.`,
            );
          } else {
            notify('error', e instanceof Error ? e.message : String(e));
          }
        }
      },
      loadFromBackend: async (): Promise<void> => {
        try {
          const r = await api.getWorkspace(prefs.url, BACKEND_WORKSPACE_ID);
          // The backend is only another input: check its snapshot with the same rules as an import.
          const codes = validateWorkspace(r.workspace);
          if (codes.length > 0) {
            notify(
              'error',
              `The backend sent a workspace that does not pass validation (${codes.join(', ')}). Nothing was replaced.`,
            );
            return;
          }
          commitWs(r.workspace);
          setSelectedSourceId('');
          setSelectedClaimId('');
          setRevision(r.revision);
          notify('success', `Loaded revision ${r.revision} from the backend.`);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            setRevision(null);
            notify('info', 'Nothing is stored on the backend yet.');
          } else {
            notify('error', e instanceof Error ? e.message : String(e));
          }
        }
      },
    }),
    [prefs, status, caps, revision, backendError, aiOptIn, probe, notify, commitWs],
  );

  // ---- workspace -------------------------------------------------------------------------------
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === WORKSPACE_KEY) setOtherTab(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const onHash = (): void => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: View): void => {
    window.location.hash = `/${next}`;
    setView(next);
  }, []);

  const run = useCallback(
    <T,>(op: (w: Workspace, at: string) => OpResult<T>): OpResult<T> => {
      const result = op(wsRef.current, new Date().toISOString());
      if (result.workspace !== wsRef.current) commitWs(result.workspace);
      return result;
    },
    [commitWs],
  );

  const api2: AppApi = {
    ws,
    replaceWorkspace: (next, message) => {
      commitWs(next);
      setSelectedSourceId('');
      setSelectedClaimId('');
      setNotice({ kind: 'success', text: message });
    },
    run,
    notify,
    backend,
    selectedSourceId: ws.sources.some((s) => s.id === selectedSourceId)
      ? selectedSourceId
      : (ws.sources[0]?.id ?? ''),
    setSelectedSourceId,
    selectedClaimId: ws.claims.some((c) => c.id === selectedClaimId) ? selectedClaimId : '',
    setSelectedClaimId,
    go,
  };

  const sample = isSampleWorkspace(ws);
  const connected = status === 'online';

  return (
    <AppProvider value={api2}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="brand">
          <h1>SourceTrace</h1>
          <p className="tagline">
            Claim and citation review. A person decides; the tool keeps the trail.
          </p>
        </div>
        <div className="chips" aria-label="Workspace status">
          <span className={`chip ${connected ? 'chip-on' : ''}`} data-testid="mode-chip">
            {connected ? 'Backend connected' : 'Local-data mode (no backend)'}
          </span>
          {sample ? (
            <span className="chip chip-sample" data-testid="sample-indicator">
              Sample data (synthetic)
            </span>
          ) : null}
        </div>
        <nav aria-label="Main" className="main-nav">
          <ul>
            {VIEWS.map((v) => (
              <li key={v.id}>
                <a
                  href={`#/${v.id}`}
                  aria-current={view === v.id ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(v.id);
                  }}
                >
                  {v.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="banners">
        {recovered ? (
          <p className="banner banner-warn" role="alert">
            The stored workspace could not be read ({recovered}). A copy was kept in this browser
            and you are looking at an empty workspace.{' '}
            <button
              type="button"
              onClick={() => {
                const raw = readCorruptCopy();
                if (raw === null) notify('error', 'The unreadable copy is no longer available.');
                else downloadText('unreadable-workspace.json', raw, 'application/json');
              }}
            >
              Download the unreadable copy
            </button>
          </p>
        ) : null}
        {storageError ? (
          <p className="banner banner-error" role="alert" data-testid="save-failed">
            {storageError}
          </p>
        ) : null}
        {otherTab ? (
          <p className="banner banner-warn" role="alert">
            This workspace was changed in another tab. Reload this page to see it; saving here would
            overwrite it.{' '}
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </p>
        ) : null}
        <div
          className={notice ? `banner banner-${notice.kind}` : 'banner-empty'}
          role={notice?.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="notice"
        >
          {notice ? (
            <>
              {notice.text}{' '}
              <button type="button" className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </>
          ) : null}
        </div>
      </div>

      <main id="main" tabIndex={-1}>
        {view === 'sources' ? <SourcesView /> : null}
        {view === 'review' ? <ReviewView /> : null}
        {view === 'report' ? <ReportView /> : null}
        {view === 'settings' ? <SettingsView /> : null}
        {view === 'about' ? <AboutView /> : null}
      </main>
      <footer className="app-footer">
        <p>
          SourceTrace records a reviewer&rsquo;s decisions. Its checks are heuristics and nothing it
          shows verifies that a claim is true.
        </p>
      </footer>
    </AppProvider>
  );
}
