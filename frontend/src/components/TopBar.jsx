import ProjectMenu from './ProjectMenu.jsx';
import { desktop } from '../api.js';

/* The window is frameless with a hidden title bar: Windows paints the native
 * minimize/maximize/close buttons over the pane's top-right corner, drag comes
 * from the .bar-drag strip, so this header only owns the project trigger and
 * the empty drag space between them. */
export default function TopBar({
  projectName,
  projectPath,
  menuOpen,
  onToggleMenu,
  onCloseMenus,
  menu,
}) {
  return (
    <header className="bar">
      <div className="project">
        <button
          type="button"
          className="project-trigger"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          hidden={!projectName}
          onClick={onToggleMenu}
        >
          <svg className="folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6a2 2 0 0 1 2-2h3.6l2 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span id="project-name" title={projectPath}>
            {projectName}
          </span>
          <svg className="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {menu}
      </div>

      <div className={`bar-drag${desktop.isElectron ? ' draggable' : ''}`} onClick={onCloseMenus} />
    </header>
  );
}

export { ProjectMenu };
