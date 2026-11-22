import { useEffect, useRef, useState } from 'react';
import { api, desktop } from '../api.js';
import { BACK, GEAR, SEARCH } from './icons.jsx';

const tabs = ['General', 'Models', 'Updates'];
const runningDownload = new Set(['queued', 'downloading', 'cancelling']);

function formatSize(bytes) {
  if (bytes == null) return 'Unknown size';
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function compatibility(model, system) {
  if (!system) return null;
  if (system.gpu_type === 'discrete' && system.vram_available_gb >= model.min_vram_gb) return 'Compatible';
  if (system.ram_available_gb >= model.min_ram_gb) return 'May be slow';
  return system.gpu_type === 'discrete' ? 'Insufficient memory' : null;
}

function ModelCard({ model, library, system, busy, run, onUsed, confirm }) {
  const [expanded, setExpanded] = useState(false);
  const current = model.id === library.current;
  const phase = current ? library.phase : 'unloaded';
  const download = library.downloads[model.id];
  const downloading = runningDownload.has(download?.status);
  const cancelling = download?.status === 'cancelling';
  const percent = download?.total
    ? Math.min(100, Math.floor(100 * download.downloaded / download.total))
    : undefined;
  const state = downloading ? (cancelling ? 'Cancelling…' : 'Downloading…') : ({
    loading: 'Loading…', ready: 'Active', failed: 'Load failed', unloading: 'Removing…',
  })[phase] ?? (model.downloaded ? 'Downloaded' : 'Not downloaded');
  const compat = compatibility(model, system);
  const loading = phase === 'loading' || phase === 'unloading';

  return (
    <div className={`model-card${current ? ' is-current' : ''}`}>
      <div className="model-card-head">
        <div>
          <div className="model-card-title">{model.label}</div>
          <div className="model-card-desc">{model.description}</div>
        </div>
        <div className="model-card-status">
          {(loading || downloading) && <span className="spinner" />}
          <span className="status-text">{state}</span>
        </div>
      </div>
      <div className="model-meta">
        <span>{model.ctx.toLocaleString()} tokens</span>
        <span>{model.min_vram_gb} GiB GPU target</span>
        <span>{model.min_ram_gb} GiB RAM target</span>
        <span>{formatSize(model.size_bytes ?? model.remote_bytes)}</span>
        {compat && <span className={`compat ${compat.toLowerCase().replaceAll(' ', '-')}`}>{compat}</span>}
      </div>

      {downloading && (
        <div className="progress-block">
          <div className="progress" role="progressbar" aria-label="Model download" aria-valuenow={percent}>
            <div className="progress-fill" style={{ width: `${percent ?? 0}%` }} />
          </div>
          <div className="progress-label">
            {download.total
              ? `${percent}% · ${formatSize(download.downloaded)} of ${formatSize(download.total)}`
              : formatSize(download.downloaded)}
          </div>
        </div>
      )}
      {download?.status === 'error' && !model.downloaded && (
        <div className="progress-error" role="alert">{download.error || 'Download failed'}</div>
      )}
      {download?.status === 'cancelled' && !model.downloaded && <div className="progress-error">Download cancelled</div>}
      {phase === 'failed' && library.error && <div className="progress-error" role="alert">{library.error}</div>}

      <div className="model-actions">
        {!model.downloaded && !downloading && (
          <button type="button" className="btn" disabled={busy || loading} onClick={() => run(() => api.startDownload(model.id))}>
            {['error', 'cancelled'].includes(download?.status) ? 'Retry download' : 'Download'}
          </button>
        )}
        {downloading && (
          <button type="button" className="btn btn-danger" disabled={busy || cancelling} onClick={() => run(() => api.cancelDownload(model.id))}>
            Cancel
          </button>
        )}
        {model.downloaded && !current && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(async () => onUsed(await api.selectModel(model.id)))}>
            Use
          </button>
        )}
        {model.downloaded && current && phase !== 'ready' && !loading && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(api.loadModel)}>
            {phase === 'failed' ? 'Retry load' : 'Load'}
          </button>
        )}
        {model.downloaded && (
          <button type="button" className="btn btn-danger" disabled={busy || loading} onClick={async () => {
            if (await confirm('Delete this model?', `"${model.label}" will be deleted from disk.`, false)) {
              await run(() => api.deleteModel(model.id));
            }
          }}>
            Delete
          </button>
        )}
        <button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide details' : 'Details'}
        </button>
      </div>
      {expanded && (
        <div className="model-details">
          <div>Architecture: {model.arch}</div>
          <div>Quantization: {model.quant}</div>
          <div>Repository: {model.repo}</div>
          {model.path && <div>Path: {model.path}</div>}
        </div>
      )}
    </div>
  );
}

function UpdateSettings({ update }) {
  const [checkError, setCheckError] = useState('');
  const message = ({
    checking: 'Checking for updates…',
    available: `Update ${update.version ?? ''} available`,
    current: 'Simpld is up to date.',
    downloading: `Downloading update: ${update.progress}%`,
    ready: 'Update downloaded and ready to install.',
    failed: update.error,
    preview: `Version ${update.version} is available. Install a release build to receive automatic updates.`,
  })[update.phase];
  return (
    <section className="settings-section">
      <h3>Software updates</h3>
      <div className="setting-row">
        <div><div className="setting-title">Simpld desktop{update.currentVersion ? ` · ${update.currentVersion}` : ''}</div>
          <div className="settings-sub" role="status">{checkError || (desktop.isElectron ? (message || 'Check for the latest version of Simpld.') : 'Updates are available in the desktop app.')}</div>
          {update.checkedAt && <div className="settings-sub">Last checked {new Date(update.checkedAt).toLocaleString()}</div>}
        </div>
      <div className="setting-actions">
        <button type="button" className="btn" disabled={['checking', 'available', 'downloading', 'ready'].includes(update.phase)}
          onClick={async () => {
            setCheckError('');
            try { await window.electron.checkForUpdates(); } catch (err) { setCheckError(err.message); }
          }} hidden={!desktop.isElectron}>
          Check for updates
        </button>
        {update.phase === 'preview' && <button type="button" className="btn" onClick={() => window.electron.openReleases().catch((err) => setCheckError(err.message))}>View release</button>}
        {update.phase === 'ready' && (
          <button type="button" className="btn" onClick={() => window.electron.installUpdate().catch((err) => setCheckError(err.message))}>
            Install update
          </button>
        )}
      </div>
      </div>
    </section>
  );
}

export default function SettingsPage({
  tab, onTabChange, onClose, confirm, onUsed, confirmDelete, onToggleConfirmDelete, update, error,
}) {
  const [library, setLibrary] = useState(null);
  const [system, setSystem] = useState(null);
  const [pollError, setPollError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (tab !== 'Models') return;
    const controller = new AbortController();
    api.system(controller.signal).then(setSystem).catch(() => {});
    return () => controller.abort();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'Models' || busy) return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const data = await api.library(controller.signal);
        if (!controller.signal.aborted) {
          setLibrary(data);
          setPollError('');
        }
      } catch (err) {
        if (!controller.signal.aborted) setPollError(err.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, busy]);

  async function run(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  return (
    <>
    <aside className="sidebar settings-sidebar">
      <div className="settings-sidebar-top">
        <span>Settings</span>
        <button type="button" className="side-icon" aria-label="Back to chat" title="Back to chat" onClick={onClose}>{BACK}</button>
      </div>
      <label className="settings-search">{SEARCH}<input aria-label="Search settings" placeholder="Search settings..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <nav className="settings-navigation" aria-label="Settings">
        {['Preferences', 'Local AI', 'Application'].map((group, index) => {
          const name = tabs[index];
          if (query && !`${group} ${name}`.toLowerCase().includes(query.toLowerCase())) return null;
          return <div key={group} className="settings-nav-group"><div className="settings-nav-label">{group}</div>
            <button type="button" className={`side-item${tab === name ? ' is-active' : ''}`} aria-current={tab === name ? 'page' : undefined} onClick={() => onTabChange(name)}>
              {name === 'General' ? GEAR : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{name === 'Models' ? <><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/></> : <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/></>}</svg>}
              <span>{name}</span>
            </button></div>;
        })}
        {query && !tabs.some((name, index) => `${['Preferences', 'Local AI', 'Application'][index]} ${name}`.toLowerCase().includes(query.toLowerCase())) && <div className="side-empty">No matching settings</div>}
      </nav>
    </aside>
    <div className="pane settings-pane">
      <div className="bar settings-bar">
        <div className={`bar-drag${desktop.isElectron ? ' draggable' : ''}`} />
      </div>
      <div className="settings-page">
        <div className="settings-page-head">
          <div>
            <h2>{tab}</h2>
            <div className="settings-sub">
              {tab === 'Models' ? 'Choose, download and manage local models.' : tab === 'Updates' ? 'Keep your desktop app up to date.' : 'Make Simpld feel right for you.'}
            </div>
          </div>
        </div>
        <div className="settings-page-body">
          {error && <div className="error-bubble" role="alert">{error}</div>}
          {tab === 'Models' ? (
            <>
              {system?.ram_total_gb > 0 && (
                <div className="hw-panel">
                  <span>System RAM: {system.ram_available_gb ?? '—'}/{system.ram_total_gb} GiB available</span>
                  {system.gpu_type === 'discrete' && (
                    <span>GPU: {system.vram_available_gb}/{system.vram_total_gb} GiB available</span>
                  )}
                </div>
              )}
              {pollError && <div className="progress-error" role="alert">{pollError}</div>}
              {actionError && <div className="progress-error" role="alert">{actionError}</div>}
              <div className="settings-list">
                {!library && !pollError && <div className="settings-sub">Loading…</div>}
                {library?.models.map((model) => (
                  <ModelCard key={model.id} model={model} library={library} system={system}
                    busy={busy} run={run} onUsed={onUsed} confirm={confirm} />
                ))}
              </div>
            </>
          ) : tab === 'Updates' ? <UpdateSettings update={update} /> : (
            <div className="settings-general">
              <section className="settings-section">
                <h3>Preferences</h3>
                <label className="setting-row setting-toggle-row">
                  <div><div className="setting-title">Confirm before deleting</div><div className="settings-sub">Ask before deleting a chat or project.</div></div>
                  <input className="settings-switch" type="checkbox" role="switch" checked={confirmDelete} onChange={(event) => onToggleConfirmDelete(event.target.checked)} />
                </label>
              </section>
              <UpdateSettings update={update} />
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
