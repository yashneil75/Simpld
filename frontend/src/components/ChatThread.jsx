import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolActivity from './ToolActivity.jsx';

// A model may use either marker spelling, including across streamed chunks.
const OPEN_MARKERS = ['<think>', '<thinking>'];
const OPEN_MARKER = /<(?:think|thinking)>/;
const CLOSE_MARKER = /<\/(?:think|thinking)>/;

function splitThinking(content, isStreaming = false) {
  const close = content.match(CLOSE_MARKER);
  if (close) {
    // Sequential passes also remove markers formed by removing nested markers.
    const thinking = content.slice(0, close.index)
      .replaceAll('<think>', '').replaceAll('<thinking>', '').replaceAll('<thinking>', '').trim();
    const answer = content.slice(close.index + close[0].length).trim();
    return { thinking, answer, done: true };
  }
  const open = content.match(OPEN_MARKER);
  if (open) {
    const thinking = content.slice(open.index + open[0].length).trim();
    const answer = content.slice(0, open.index).trim();
    return { thinking, answer, done: false };
  }
  const text = content.trim();
  if (isStreaming && OPEN_MARKERS.some((marker) => marker.startsWith(text))) {
    return { thinking: '', answer: '', done: false };
  }
  return { thinking: '', answer: text, done: true };
}

function Spinner() {
  return <span className="spinner" aria-label="Thinking" />;
}

function TokPerSec({ tokPerSec }) {
  return <span className="tokps">{(tokPerSec || 0).toFixed(1)} tok/s</span>;
}

function activityFor(message) {
  const runs = message.tool_runs || [];
  if (runs.some((entry) => entry.type === 'message') || !message.tool_history?.length) return runs;
  // Earlier chats already saved intermediate messages in model context.
  const entries = [];
  const used = new Set();
  message.tool_history.forEach((entry, index) => {
    if (entry.role !== 'assistant') return;
    if (entry.content?.trim()) entries.push({ id: `history-${index}`, type: 'message', content: entry.content });
    entry.tool_calls?.forEach((call) => {
      const run = runs.find((item) => item.id === call.id);
      if (run) { entries.push(run); used.add(run.id); }
    });
  });
  return [...entries, ...runs.filter((run) => !used.has(run.id))];
}

function formatDuration(total) {
  const seconds = Math.max(0, Math.floor(total));
  const units = [[Math.floor(seconds / 3600), 'hour'], [Math.floor(seconds / 60) % 60, 'minute'], [seconds % 60, 'second']];
  return units.filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`).join(' ') || '0 seconds';
}

function Message({ role, content, streaming, tokPerSec, toolRuns = [], workSeconds }) {
  const copyBtn = useRef(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      const btn = copyBtn.current;
      if (!btn) return;
      btn.dataset.copied = '';
      setTimeout(() => delete btn.dataset.copied, 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  if (role === 'user') {
    return (
      <div className={`msg ${role}`}>
        <p>{content}</p>
      </div>
    );
  }

  const { thinking, answer } = splitThinking(content, streaming);

  return (
    <div className={`msg ${role}${streaming ? ' streaming' : ''}`}>
      <ToolActivity runs={toolRuns} thinking={thinking} streaming={streaming} />
      {answer && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}>{answer}</ReactMarkdown>
      )}
      {streaming && (
        <div className="stream-spinner">
          <Spinner />
          <TokPerSec tokPerSec={tokPerSec} />
        </div>
      )}
      {!streaming && workSeconds != null && <div className="worked-for">Worked for {formatDuration(workSeconds)}</div>}
      {!streaming && content && (
        <div className="actions">
          <button ref={copyBtn} type="button" data-copy aria-label="Copy" onClick={copy}>
            <svg className="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a2 2 0 0 1 2-2h9" />
            </svg>
            <svg className="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatThread({ messages, streamingText, streamingTools = [], startedAt, workSeconds, tokPerSec }) {
  const ref = useRef(null);
  const stickToBottom = useRef(true);

  const isNearBottom = () => {
    const el = ref.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, streamingTools]);

  const onScroll = (event) => {
    if (event.target !== event.currentTarget) return;
    stickToBottom.current = isNearBottom();
  };

  const visible = messages.filter(
    ({ role, content, tool_runs }) => (role === 'user' || role === 'assistant') && (content || tool_runs?.length),
  );
  const displayed = [...visible];
  if (streamingText !== null) displayed.push({ role: 'assistant', content: streamingText, tool_runs: streamingTools, streaming: true, work_seconds: workSeconds, startedAt });

  return (
    <main ref={ref} className="thread" aria-live="polite" onScroll={onScroll}>
      {displayed.map((m, i) => (
        <Message key={i} role={m.role} content={m.content || ''} toolRuns={activityFor(m)} streaming={m.streaming} startedAt={m.startedAt} workSeconds={m.work_seconds} tokPerSec={tokPerSec} />
      ))}
    </main>
  );
}
