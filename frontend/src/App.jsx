import { useEffect, useReducer, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import ProjectMenu from './components/ProjectMenu.jsx';
import ModelMenu from './components/ModelMenu.jsx';
import EffortMenu from './components/EffortMenu.jsx';
import ChatThread from './components/ChatThread.jsx';
import Composer from './components/Composer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import { api, desktop, streamChat } from './api.js';

const idle = { phase: 'idle' };
const permissionOptions = [
  { name: 'read_only', label: 'Read only' },
  { name: 'accept_edits', label: 'Accept Edits' },
  { name: 'allow_all', label: 'Allow all' },
];
const reasoningOptions = [
  { name: 'low', label: 'Low' },
  { name: 'medium', label: 'Medium' },
  { name: 'xhigh', label: 'Extra high' },
];

function replyReducer(state, event) {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'streaming', text: '', rate: 0, tools: [], startedAt: Date.now(), conversation: event.conversation, project: event.project, revision: event.revision } : state;
    case 'tool':
      return state.phase === 'idle' ? state : { ...state, tools: state.tools.some((tool) => tool.id === event.tool.id) ? state.tools.map((tool) => tool.id === event.tool.id ? event.tool : tool) : [...state.tools, event.tool] };
    case 'meta':
      return state.phase === 'idle' ? state : { ...state, ...(event.conversation != null ? { conversation: event.conversation, project: event.project } : {}), ...(event.work_seconds != null ? { workSeconds: event.work_seconds } : {}) };
    case 'reset':
      return state.phase === 'idle' ? state : { ...state, text: '' };
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
  const [permissionMode, setPermissionMode] = useState('read_only');
  const [approval, setApproval] = useState(null);
  const [deciding, setDeciding] = useState(false);
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
  const navigationVersion = useRef(0);
  const askResolve = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    controller.conversation = session.currentChat;
    async function connect() {
      for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt += 1) {
        try {
          const [settings, models, snapshot] = await Promise.all([
            api.settings(controller.signal), api.models(controller.signal), api.session(controller.signal),
          ]);
          if (controller.signal.aborted) return;
          setConfirmDelete(settings.confirm_delete);
          setPermissionMode(settings.permission_mode || 'read_only');
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
    setApproval(null);
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
    dispatchReply({ type: 'start', conversation: session.currentChat, project: session.currentProject, revision: session.revision });

    try {
      await streamChat(text, {
        reasoningLevel,
        revision: session.revision,
        signal: controller.signal,
        onTool: (tool) => {
          if (stream.current === controller) dispatchReply({ type: 'tool', tool });
        },
        onApproval: (request) => {
          if (stream.current === controller) { setApproval(request); setSettingsTab(null); }
        },
        onMeta: (meta) => {
          if (stream.current !== controller) return;
          if (meta.conversation != null) {
            controller.conversation = meta.conversation;
            setSession((current) => ({
              ...current,
              ...(meta.chats ? { chats: meta.chats } : {}),
              ...(current.revision === session.revision && current.currentProject === meta.project ? { currentChat: meta.conversation } : {}),
            }));
          }
          dispatchReply({ type: 'meta', ...meta });
        },
        onReset: () => {
          if (stream.current === controller) { partial = ''; dispatchReply({ type: 'reset' }); }
        },
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
      // Navigation and stream completion can finish in either order. Refresh
      // after the latest navigation so an older snapshot cannot replace it.
      let snapshot;
      for (;;) {
        if (navigation.current) await navigation.current;
        const version = navigationVersion.current;
        snapshot = await api.session(undefined, controller.signal.aborted);
        if (version === navigationVersion.current && !navigation.current) break;
      }
      if (stream.current !== controller) return;
      setSession(snapshot);
      if (failure && snapshot.revision === session.revision && snapshot.messages.length === session.messages.length) {
        setInput((draft) => draft || text);
      }
    } catch (err) {
      if (stream.current !== controller) return;
      if (partial) {
        setSession((current) => ({
          ...current, messages: current.currentChat === controller.conversation ? [...current.messages, { role: 'assistant', content: partial }] : current.messages,
        }));
      }
      failure ||= err.message;
    } finally {
      if (stream.current === controller) {
        stream.current = null;
        setApproval(null);
        if (failure) setError(failure);
        dispatchReply({ type: 'finish' });
      }
    }
  }

  function navigate(action, { clearDraft = true } = {}) {
    if (startup !== 'ready') return;
    navigationVersion.current += 1;
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

  async function changePermissionMode(value) {
    setMenu(null);
    try {
      await api.setSetting('permission_mode', value);
      setPermissionMode(value);
    } catch (err) { setError(err.message); }
  }

  async function decidePermission(allow) {
    if (!approval || deciding) return;
    setDeciding(true);
    try {
      await api.decidePermission(approval.id, allow);
      setApproval(null);
    } catch (err) {
      setError(err.message);
      setApproval(null);
      stopStream();
    } finally { setDeciding(false); }
  }

  const { messages, chats, currentChat, projects, currentProject, workspace } = session;
  const model = catalog?.tiers.find((item) => item.name === catalog.current);
  const hasEffort = !model?.reasoning_levels || model.reasoning_levels.length > 0;
  const projectName = projects.find((project) => project.path === currentProject)?.name ?? currentProject;
  const viewingReply = reply.phase !== 'idle' && reply.project === currentProject && (reply.conversation != null ? reply.conversation === currentChat : reply.revision === session.revision);
  const isHero = messages.length === 0 && !viewingReply;
  const projectOpen = menu === 'project';
  const modelOpen = menu === 'model';

  return (
    <div className="app" onClick={(event) => {
      if (!event.target.closest('.model, .project')) setMenu(null);
    }}>
      {!settingsTab && <Sidebar
        chats={chats}
        current={currentChat}
        projectList={projects}
        onNew={() => { setSettingsTab(null); navigate(api.newChat); }}
        onOpen={(id) => { setSettingsTab(null); navigate(() => api.openChat(id)); }}
        onDelete={deleteChat}
        onOpenSettings={() => setSettingsTab('General')}
        onBrowse={browseForFolder}
        update={update}
      />}

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
          {!isHero && <ChatThread key={currentChat ?? session.revision} messages={messages} streamingText={viewingReply ? reply.text ?? '' : null} streamingTools={viewingReply ? reply.tools || [] : []} startedAt={reply.startedAt} workSeconds={reply.workSeconds} tokPerSec={reply.rate ?? 0} />}
          {error && (
            <div className="dock" style={{ paddingBottom: 0 }}>
              <div className="error-bubble" role="alert">{error}</div>
            </div>
          )}

          <div className="dock">
            <h1 className="hero">What next?</h1>
            {approval && <section className="permission-card" role="region" aria-label="Permission request" aria-live="polite">
              <div className="permission-heading">Allow {approval.name.replaceAll('_', ' ')}?</div>
              <div className="permission-project">{approval.project}</div>
              <pre>{approval.arguments.command || approval.arguments.path || JSON.stringify(approval.arguments, null, 2)}</pre>
              {approval.arguments.content != null && <pre className="permission-preview">{approval.arguments.content}</pre>}
              {approval.arguments.old_text != null && <div className="permission-diff"><pre className="permission-old">{approval.arguments.old_text}</pre><pre className="permission-new">{approval.arguments.new_text}</pre></div>}
              <div className="permission-actions"><span>Allow this action once</span><button type="button" disabled={deciding} onClick={() => decidePermission(false)}>Deny</button><button type="button" className="permission-allow" disabled={deciding} onClick={() => decidePermission(true)}>Allow</button></div>
            </section>}
            <Composer
              value={input}
              onChange={setInput}
              onSend={send}
              phase={reply.phase}
              disabled={startup !== 'ready' || navigating}
              onStop={stopStream}
            />
            <div className="meta">
              <div className="model">
                <button type="button" className="model-trigger" aria-label={`Tool permissions: ${permissionOptions.find((option) => option.name === permissionMode)?.label}`} title="Select permissions" aria-haspopup="menu" aria-expanded={menu === 'permissions'} disabled={reply.phase !== 'idle' || startup !== 'ready'} onClick={() => setMenu(menu === 'permissions' ? null : 'permissions')}>
                  <span>{permissionOptions.find((option) => option.name === permissionMode)?.label}</span>
                </button>
                <ModelMenu open={menu === 'permissions'} tiers={permissionOptions} current={permissionMode} onSelect={changePermissionMode} label="Tool permissions" heading="Select permissions" />
              </div>
              <div className="model">
                <button
                  type="button"
                  className="model-trigger"
                  aria-label={`${model?.label || 'Select model'}${hasEffort ? `, ${reasoningOptions.find((option) => option.name === reasoningLevel)?.label} effort` : ''}`}
                  title="Select model and effort"
                  aria-haspopup="dialog"
                  aria-expanded={menu === 'reasoning' || modelOpen}
                  disabled={reply.phase !== 'idle'}
                  onClick={() => setMenu(menu === 'reasoning' || modelOpen ? null : hasEffort ? 'reasoning' : 'model')}
                >
                  <span>{model?.label || 'Select model'} {hasEffort && <span style={{ color: 'var(--muted)' }}>{reasoningOptions.find((option) => option.name === reasoningLevel)?.label}</span>}</span>
                </button>
                {model && <ModelMenu open={modelOpen} tiers={catalog.tiers} current={model.name} onSelect={selectModel} />}
                <EffortMenu open={hasEffort && menu === 'reasoning' && reply.phase === 'idle'} options={reasoningOptions} value={reasoningLevel} modelLabel={model?.label}
                  onSelectModel={() => setMenu('model')}
                  onChange={(level) => {
                    setReasoningLevel(level);
                    try { localStorage.setItem('simpld.reasoningLevel', level); } catch { /* Storage may be unavailable. */ }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog ask={ask} onResolve={resolveAsk} />
    </div>
  );
}
