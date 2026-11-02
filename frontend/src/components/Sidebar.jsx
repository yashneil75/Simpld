import { useEffect, useRef, useState } from 'react';
import { BIN, PEN, GEAR, FOLDER, SEARCH } from './icons.jsx';
import logo from '../../../Logo.png';

/* Sidebar layout mirrors the reference: brand, New chat, Settings, a
 * "Sessions" header with an inline search, a New project row, chat groups,
 * and a status footer (update progress / availability). */
export default function Sidebar({
  chats,
  current,
  projectList,
  onNew,
  onOpen,
  onDelete,
  onOpenSettings,
  onBrowse,
  updateAvailable,
  updateDownloaded,
  updateVersion,
  updateProgress,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const q = query.trim().toLowerCase();
  const groups = new Map();
  for (const chat of chats) {
    if (q && !chat.title.toLowerCase().includes(q)) continue;
    if (!groups.has(chat.project)) groups.set(chat.project, []);
    groups.get(chat.project).push(chat);
  }
  const order = [...new Set([...projectList.map((p) => p.path), ...groups.keys()])]
    .filter((path) => groups.has(path));

  const toggleSearch = () => {
    setSearchOpen((v) => !v);
    setQuery('');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logo} alt="Simpld" className="sidebar-logo" />
        <span className="sidebar-title">Simpld</span>
      </div>

      <div className="side-items">
        <button type="button" className="side-item" onClick={onNew}>
          {PEN}
          <span>New chat</span>
        </button>
        <button type="button" className="side-item" onClick={onOpenSettings}>
          {GEAR}
          <span>Settings</span>
        </button>
      </div>

      <div className="side-head">
        <span>Sessions</span>
        <button
          type="button"
          className="side-icon"
          aria-label="Search sessions"
          aria-pressed={String(searchOpen)}
          title="Search sessions"
          onClick={toggleSearch}
        >
          {SEARCH}
        </button>
      </div>
      {searchOpen && (
        <input
          ref={inputRef}
          type="text"
          className="sidebar-search"
          placeholder="Search sessions…"
          aria-label="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      <button type="button" className="side-item" onClick={onBrowse}>
        {FOLDER}
        <span>New project</span>
      </button>

      <nav className="chats" aria-label="Chats">
        {order.map((path) => {
          const name = projectList.find((p) => p.path === path)?.name ?? path;
          return (
            <div key={path}>
              <div className="group-name" title={path}>
                {FOLDER}
                <span className="group-title">{name}</span>
              </div>
              {groups.get(path).map(({ id, title }) => (
                <div key={id} className="chat" aria-current={String(id === current)}>
                  <button
                    type="button"
                    className="chat-open"
                    title={title}
                    onClick={() => onOpen(id)}
                  >
                    {title}
                  </button>
                  <button
                    type="button"
                    className="chat-delete"
                    aria-label={`Delete chat: ${title}`}
                    onClick={() => onDelete(id, title, id === current)}
                  >
                    {BIN}
                  </button>
                </div>
              ))}
            </div>
          );
        })}
        {q && order.length === 0 && <div className="side-empty">No matching sessions</div>}
      </nav>

      {/* Footer only exists when there is a status to show — an empty bar with
          its separator reads as a stray divider at the bottom of the rail. */}
      {((updateProgress > 0 && updateProgress < 100) || updateDownloaded || updateAvailable) && (
        <div className="sidebar-foot">
          {updateProgress > 0 && updateProgress < 100 && (
            <div className="foot-status" aria-live="polite">
              <span className="spinner" />
              <span>{updateProgress}%</span>
            </div>
          )}
          {updateDownloaded && (
            <button type="button" className="foot-status as-button" onClick={onOpenSettings}>
              Update ready — restart to install
            </button>
          )}
          {updateAvailable && !updateDownloaded && !(updateProgress > 0 && updateProgress < 100) && (
            <button type="button" className="foot-status as-button" onClick={onOpenSettings}>
              Update available{updateVersion ? ` · v${updateVersion}` : ''}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
