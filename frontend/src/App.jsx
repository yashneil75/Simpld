import { useEffect, useReducer, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ProjectMenu from './components/ProjectMenu.jsx';
import ModelMenu from './components/ModelMenu.jsx';
import ChatThread from './components/ChatThread.jsx';
import Composer from './components/Composer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import { api, desktop, streamChat } from './api.js';

const idle = { phase: 'idle' };

function replyReducer(state, event) {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'streaming', text: '', rate: 0 } : state;
    case 'token':
      return state.phase === 'streaming' ? { ...state, text: event.text, rate: event.rate } : state;
    case 'stop':
      return state.phase === 'streaming' ? { ...state, phase: 'stopping' } : state;
    case 'finish':
      return idle;
    default:
      return state;
  }
}

const emptySession = {
  revision: null, messages: [], chats: [], currentChat: null,
  projects: [], currentProject: '', workspace: '',
};

export default function App() {
  const [session, setSession] = useState(emptySession);
  const [startup, setStartup] = useState('connecting');
  const [catalog, setCatalog] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [update, setUpdate] = useState({ phase: 'idle' });
  const [ask, setAsk] = useState(null);
  const [menu, setMenu] = useState(null);
  const [settingsTab, setSettingsTab] = useState(null);
  const [input, setInput] = useState('');
  const [reasoningLevel, setReasoningLevel] = useState(() => {
    try {
      const stored = localStorage.getItem('simpld.reasoningLevel');
      const saved = stored === 'high' ? 'xhigh' : stored;
      return ['low', 'medium', 'xhigh'].includes(saved) ? saved : 'medium';
    } catch {
      return 'medium';
    }
  });
  const [reply, dispatchReply] = useReducer(replyReducer, idle);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState('');
  const stream = useRef(null);
  const navigation = useRef(null);
  const askResolve = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    async function connect() {
      for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt += 1) {
        try {
          const [settings, models, snapshot] = await Promise.all([
            api.settings(controller.signal), api.models(controller.signal), api.session(controller.signal),
          ]);
          if (controller.signal.aborted) return;
          setConfirmDelete(settings.confirm_delete);
          setCatalog(models);
          setSession(snapshot);
          setStartup('ready');
          return;
        } catch {
          if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!controller.signal.aborted) {
        setStartup('failed');
        setError('Could not reach the Python backend. Restart Simpld to retry.');
      }
    }
    connect();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!window.electron) return;
    if (window.electron.platform === 'darwin') {
      document.documentElement.style.setProperty('--tl', '78px');
    }
    let live = true;
    let receivedEvent = false;
    const unsubscribe = window.electron.onUpdateStatus((status) => {
      receivedEvent = true;
      setUpdate(status);
    });
    window.electron.getUpdateStatus().then((status) => {
      if (live && !receivedEvent) setUpdate(status);
    }).catch(console.error);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setMenu(null);
      if (!ask) setSettingsTab(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ask]);

  useEffect(() => () => stream.current?.abort(), []);

  const stopStream = () => {
    if (!stream.current) return;
    dispatchReply({ type: 'stop' });
    stream.current.abort();
  };

  async function send(text) {
    if (stream.current || navigation.current || startup !== 'ready') return;
    const controller = new AbortController();
    stream.current = controller;
    const started = performance.now();
    let tokens = 0;
    let partial = '';
    let failure;
    const prompt = { role: 'user', content: text };

    setError('');
    setSession((current) => ({ ...current, messages: [...current.messages, prompt] }));
    setInput('');
    dispatchReply({ type: 'start' });

    try {
      await streamChat(text, {
        reasoningLevel,
        revision: session.revision,
        signal: controller.signal,
        onToken: (_token, assembled) => {
          if (stream.current !== controller) return;
          partial = assembled;
          tokens += 1;
          dispatchReply({
            type: 'token', text: partial,
            rate: tokens / Math.max((performance.now() - started) / 1000, 0.001),
          });
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') failure = err.message;
    }

    if (stream.current !== controller) return;
    try {
      const snapshot = await api.session(undefined, controller.signal.aborted);
      if (stream.current !== controller) return;
      setSession(snapshot);
      if (failure && snapshot.revision === session.revision && snapshot.messages.length === session.messages.length) {
        setInput((draft) => draft || text);
      }
    } catch (err) {
      if (stream.current !== controller) return;
      if (partial) {
        setSession((current) => ({
          ...current, messages: [...current.messages, { role: 'assistant', content: partial }],
        }));
      }
      failure ||= err.message;
    } finally {
      if (stream.current === controller) {
        stream.current = null;
        if (failure) setError(failure);
        dispatchReply({ type: 'finish' });
      }
    }
  }

  function navigate(action, { clearDraft = true } = {}) {
    if (startup !== 'ready') return;
    if (stream.current) {
      stream.current.abort();
      stream.current = null;
      dispatchReply({ type: 'finish' });
    }
    setNavigating(true);
    setMenu(null);
    setError('');
    const next = (navigation.current ?? Promise.resolve()).then(async () => {
      try {
        await action();
        if (clearDraft) setInput('');
        setSession(await api.session());
      } catch (err) {
        setError(err.message);
      } finally {
        if (navigation.current === next) {
          navigation.current = null;
          setNavigating(false);
        }
      }
    });
    navigation.current = next;
    return next;
  }

  function confirm(title, text, allowOptOut = true) {
    if (allowOptOut && !confirmDelete) return Promise.resolve(true);
    if (askResolve.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      askResolve.current = resolve;
      setAsk({ title, text, allowOptOut });
    });
  }

  async function saveConfirmDelete(value) {
    try {
      await api.setSetting('confirm_delete', value);
      setConfirmDelete(value);
    } catch (err) {
      setError(err.message);
    }
  }

  function resolveAsk(ok, never) {
    const resolve = askResolve.current;
    askResolve.current = null;
    setAsk(null);
    if (ok && never) saveConfirmDelete(false);
    resolve?.(ok);
  }

  async function browseForFolder() {
    setMenu(null);
    try {
      const path = await desktop.openFolder();
      if (path) navigate(() => api.openProject(path));
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteChat(id, title) {
    if (await confirm('Delete this chat?', `"${title}" and its messages will be deleted permanently.`)) {
      navigate(() => api.deleteChat(id), { clearDraft: id === session.currentChat });
    }
  }

  async function deleteProject(path, name) {
    if (await confirm('Delete this project?', `"${name}" and its chats will be deleted permanently. The folder itself is left on disk.`)) {
      navigate(() => api.deleteProject(path), { clearDraft: path === session.currentProject });
    }
  }

  async function selectModel(name) {
    setMenu(null);
    if (name === catalog?.current) return;
    try {
      setCatalog(await api.selectModel(name));
    } catch (err) {
      setError(err.message);
    }
  }

  const { messages, chats, currentChat, projects, currentProject, workspace } = session;
  const model = catalog?.tiers.find((item) => item.name === catalog.current);
  const projectName = projects.find((project) => project.path === currentProject)?.name ?? currentProject;
  const isHero = messages.length === 0 && reply.phase === 'idle';
  const projectOpen = menu === 'project';
  const modelOpen = menu === 'model';

  return (
    <div className="app" onClick={(event) => {
      if (!event.target.closest('.model, .project')) setMenu(null);
    }}>
      <Sidebar
        chats={chats}
        current={currentChat}
        projectList={projects}
        onNew={() => { setSettingsTab(null); navigate(api.newChat); }}
        onOpen={(id) => { setSettingsTab(null); navigate(() => api.openChat(id)); }}
        onDelete={deleteChat}
        onOpenSettings={() => setSettingsTab('General')}
        onBrowse={browseForFolder}
        update={update}
      />

      {settingsTab ? (
        <SettingsPage
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onClose={() => setSettingsTab(null)}
          confirm={confirm}
          onUsed={setCatalog}
          confirmDelete={confirmDelete}
          onToggleConfirmDelete={saveConfirmDelete}
          update={update}
          error={error}
        />
      ) : (
        <div className={`pane${isHero ? ' is-hero' : ''}`}>
          <TopBar
            projectName={projectName}
            projectPath={currentProject}
            menuOpen={projectOpen}
            onToggleMenu={() => setMenu(projectOpen ? null : 'project')}
            menu={
              <ProjectMenu
                open={projectOpen}
                projects={projects}
                current={currentProject}
                workspace={workspace}
                onOpen={(path) => navigate(() => api.openProject(path))}
                onDelete={deleteProject}
              />
            }
          />
          {!isHero && <ChatThread key={session.revision} messages={messages} streamingText={reply.text ?? null} tokPerSec={reply.rate ?? 0} />}
          {error && (
            <div className="dock" style={{ paddingBottom: 0 }}>
              <div className="error-bubble" role="alert">{error}</div>
            </div>
          )}

          <div className="dock">
            <h1 className="hero">What next?</h1>
            <Composer
              value={input}
              onChange={setInput}
              onSend={send}
              phase={reply.phase}
              disabled={startup !== 'ready' || navigating}
              onStop={stopStream}
            />
            <div className="meta">
              {model && (
                <div className="model">
                  <button
                    type="button"
                    className="model-trigger"
                    aria-haspopup="menu"
                    aria-expanded={modelOpen}
                    onClick={() => setMenu(modelOpen ? null : 'model')}
                  >
                    <span>{model.label}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <ModelMenu open={modelOpen} tiers={catalog.tiers} current={model.name} onSelect={selectModel} />
                </div>
              )}
              <label className="reasoning-control">
                <span>Reasoning</span>
                <select
                  aria-label="Reasoning level"
                  title="How thoroughly the model should reason before answering"
                  value={reasoningLevel}
                  disabled={reply.phase !== 'idle'}
                  onChange={(event) => {
                    const level = event.target.value;
                    setReasoningLevel(level);
                    try { localStorage.setItem('simpld.reasoningLevel', level); } catch { /* Storage may be unavailable. */ }
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="xhigh">Extra high</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog ask={ask} onResolve={resolveAsk} />
    </div>
  );
}
