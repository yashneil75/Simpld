// Backend access.
// Packaged app (file://): Electron passes --backend-port, exposed synchronously
// by preload.cjs as window.electron.backendPort. No localhost tabs involved.
// Dev (Vite): same-origin /api, proxied to Python. Browser fallback: build-time
// VITE_BACKEND_URL.
function baseUrl() {
  if (typeof window !== 'undefined') {
    const port = window.electron?.backendPort;
    if (port) return `http://127.0.0.1:${port}`;
  }
  return (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
}

const url = (path) => `${baseUrl()}${path}`;

function jsonHeaders() {
  const token = window.electron?.backendToken;
  return { 'Content-Type': 'application/json', ...(token ? { 'X-Simpld-Token': token } : {}) };
}

async function responseError(response) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
}

async function req(path, options = {}) {
  const res = await fetch(url(path), {
    headers: jsonHeaders(),
    ...options,
  });
  if (!res.ok) throw await responseError(res);
  if (res.status === 204) return null;
  return res.json();
}

// Keep request encoding in one place for endpoints that send JSON bodies.
const post = (path, body) => req(path, {
  method: 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const remove = (path) => req(path, { method: 'DELETE' });

export const api = {
  decidePermission: (id, allow) => post(`/api/permissions/${id}`, { allow }),
  models: (signal) => req('/api/models', { signal }),
  selectModel: (name) => post('/api/models/select', { name }),
  openProject: (path) => post('/api/projects/open', { path }),
  deleteProject: (path) => post('/api/projects/delete', { path }),
  session: (signal, settled = false) => req(settled ? '/api/session?settled=true' : '/api/session', { signal }),
  newChat: () => post('/api/conversations/new'),
  openChat: (id) => post(`/api/conversations/${id}/open`),
  deleteChat: (id) => remove(`/api/conversations/${id}`),
  settings: (signal) => req('/api/settings', { signal }),
  setSetting: (key, value) =>
    req(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  library: (signal) => req('/api/models/library', { signal }),
  system: (signal) => req('/api/system', { signal }),
  startDownload: (name) => post('/api/models/download', { name }),
  cancelDownload: (name) => post('/api/models/download/cancel', { name }),
  deleteModel: (id) => remove(`/api/models/library/${encodeURIComponent(id)}`),
  loadModel: () => post('/api/models/load'),
};

/**
 * POST to /api/chat/stream and invoke onToken for each SSE token.
 * Returns the full assembled reply. Abort via AbortController signal.
 */
export async function streamChat(content, { onToken, onTool, onReset, onMeta, onApproval, signal, revision, reasoningLevel = 'medium' } = {}) {
  const now = new Date();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const res = await fetch(url('/api/chat/stream'), {
    method: 'POST',
    headers: { ...jsonHeaders(), Accept: 'text/event-stream' },
    body: JSON.stringify({ content, revision, reasoning_level: reasoningLevel, current_date: currentDate }),
    signal,
  });
  if (!res.ok) throw await responseError(res);
  if (!res.body) throw new Error('Streaming is unavailable.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return true;
    const { token, error, tool, reset, activity_message, work_seconds, approval, conversation, project, chats } = JSON.parse(payload);
    if (conversation != null) onMeta?.({ conversation, project, chats });
    if (approval) onApproval?.(approval);
    if (tool) onTool?.(tool);
    if (activity_message) onTool?.(activity_message);
    if (work_seconds != null) onMeta?.({ work_seconds });
    if (reset) { full = ''; onReset?.(); }
    if (error) throw new Error(error);
    if (token) {
      full += token;
      onToken?.(token, full);
    }
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (handleLine(line)) return full;
      }
      if (done) {
        if (handleLine(buffer)) return full;
        throw new Error('The response ended before it finished.');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Use Electron's folder dialog in the desktop app.
export const desktop = {
  isElectron: !!window.electron,
  openFolder: async () => {
    if (window.electron?.openFolder) return window.electron.openFolder();
    // Browser fallback: a real, native folder-browse dialog via
    // <input webkitdirectory>. Browsers only expose the picked folder's name
    // (never absolute paths), which is all the backend needs to register the
    // project and group chats under it.
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.style.display = 'none';
      const cleanup = () => input.remove();
      input.addEventListener('change', () => {
        cleanup();
        const file = input.files && input.files[0];
        if (!file) return resolve(null); // dialog dismissed
        // webkitRelativePath is "FolderName/sub/file..." — first segment wins.
        const name = file.webkitRelativePath.split(/[\\/]/)[0] || file.name;
        resolve(name);
      });
      input.addEventListener('cancel', () => {
        cleanup();
        resolve(null);
      });
      document.body.appendChild(input);
      input.click();
    });
  },
};
