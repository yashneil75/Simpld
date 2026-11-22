import { SEARCH } from './icons.jsx';
import { useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ActivityText({ content }) {
  return <div className="activity-model-message"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{content.replace(/<\/?(?:think|thinking)>/g, '\n\n')}</ReactMarkdown></div>;
}

export default function ToolActivity({ runs = [], thinking = '', streaming = false }) {
  const [open, setOpen] = useState(streaming);
  const list = useRef(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    if (open && pinned.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [runs, thinking, open]);
  if (!runs.length && !thinking) return null;
  const running = runs.some((run) => run.status === 'running');
  const awaiting = runs.some((run) => run.status === 'awaiting_permission');
  const local = runs.some((run) => ['shell', 'read_file', 'write_file', 'edit_file'].includes(run.name));
  const searched = runs.some((run) => run.name === 'search_web');
  const fetched = runs.some((run) => run.name === 'web_fetch');
  const title = awaiting ? 'Waiting for permission' : running || streaming ? 'Working' : local ? `Worked with files${runs.some((run) => run.name === 'shell') ? ', ran commands' : ''}${searched || fetched ? ', browsed the web' : ''}` : searched && fetched ? 'Searched the web, read pages' : searched ? 'Searched the web' : fetched ? 'Read web pages' : 'Thought through the response';
  return <details className="tool-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{SEARCH}<span>{title}</span>{running && <span className="spinner" />}<span className="tool-chevron">›</span></summary>
    <div className="tool-activity-list" ref={list} onScroll={(event) => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>{runs.map((run) => run.type === 'message' ? <ActivityText key={run.id} content={run.content} /> : <div className="tool-activity-row" key={run.id}>
      {SEARCH}<div>
        <div className="tool-activity-label">{{ search_web: 'Searched the web for ', web_fetch: 'Read ', read_file: 'Read ', write_file: 'Write ', edit_file: 'Edit ', shell: 'Run ' }[run.name]}{run.arguments?.query || run.arguments?.url || run.arguments?.path || run.arguments?.command || run.name}
          <span className="tool-run-status">{run.status === 'awaiting_permission' ? 'Needs permission' : run.status === 'denied' ? 'Denied' : run.status === 'running' ? 'Running…' : run.status === 'error' ? 'Failed' : run.status === 'cancelled' ? 'Stopped' : ''}</span>
        </div>
        {run.result?.error && <div className="tool-run-error">{run.result.error}</div>}
        {run.result?.output != null && <pre className="tool-output">{run.result.output}{run.result.truncated ? '\n[Output truncated]' : ''}{`\nExit code: ${run.result.exit_code}`}</pre>}
        {run.result?.results?.map((result, index) => <a key={index} className="tool-source" href={result.url} target="_blank" rel="noopener noreferrer">{result.title || result.url}</a>)}
        {run.name === 'web_fetch' && run.result?.url && <a className="tool-source" href={run.result.url} target="_blank" rel="noopener noreferrer">{run.result.url}</a>}
      </div>
    </div>)}{thinking && <ActivityText content={thinking} />}</div>
  </details>;
}
