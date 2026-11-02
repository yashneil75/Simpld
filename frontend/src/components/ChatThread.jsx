import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Reasoning markers vary by model family. Support the common variants so a
// reply is split correctly regardless of which one the model emits.
const OPEN_MARKERS = [
  '<' + 'think' + '>',
  '<' + 'think' + 'ing>',
  '<' + 'thinking' + '>',
];
const CLOSE_MARKERS = [
  '<' + '/' + 'think' + '>',
  '<' + '/' + 'think' + 'ing>',
  '<' + '/' + 'thinking' + '>',
];

function findEarliest(text, markers) {
  let best = -1;
  let marker = null;
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx !== -1 && (best === -1 || idx < best)) {
      best = idx;
      marker = m;
    }
  }
  return { idx: best, marker };
}

function stripOpens(text) {
  let out = text;
  for (const m of OPEN_MARKERS) out = out.split(m).join('');
  return out;
}

function splitThinking(content, isStreaming = false) {
  const { idx: closeIdx, marker: closeMarker } = findEarliest(content, CLOSE_MARKERS);
  if (closeIdx !== -1) {
    const thinking = stripOpens(content.slice(0, closeIdx)).trim();
    const answer = content.slice(closeIdx + closeMarker.length).trim();
    return { thinking, answer, done: true };
  }
  const { idx: openIdx, marker: openMarker } = findEarliest(content, OPEN_MARKERS);
  if (openIdx !== -1) {
    const thinking = content.slice(openIdx + openMarker.length).trim();
    const answer = content.slice(0, openIdx).trim();
    return { thinking, answer, done: false };
  }
  // No markers yet. While tokens are still arriving, assume the text is
  // reasoning straight from the start; a finished reply without markers is a
  // plain answer.
  if (isStreaming && content) return { thinking: content.trim(), answer: '', done: false };
  return { thinking: '', answer: content.trim(), done: true };
}

function Spinner() {
  return <span className="spinner" aria-label="Thinking" />;
}

function TokPerSec({ tokPerSec }) {
  return <span className="tokps">{(tokPerSec || 0).toFixed(1)} tok/s</span>;
}

function Message({ role, content, streaming, tokPerSec }) {
  const copyBtn = useRef(null);
  const [showThinking, setShowThinking] = useState(false);

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

  const { thinking, answer, done } = splitThinking(content, streaming);
  const isThinking = streaming && !done;

  return (
    <div className={`msg ${role}${streaming ? ' streaming' : ''}`}>
      {thinking && (
        <div className="thinking-block">
          <button
            type="button"
            className="thinking-toggle"
            aria-expanded={String(showThinking)}
            onClick={() => setShowThinking((v) => !v)}
          >
            <span>{showThinking ? 'Hide thinking' : 'Show thinking'}</span>
            {isThinking && <Spinner />}
            {isThinking && <TokPerSec tokPerSec={tokPerSec} />}
          </button>
          {/* Reasoning renders unboxed and grayed out, like a margin note. */}
          {showThinking && <div className="thinking-text">{thinking}</div>}
        </div>
      )}
      {answer && <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>}
      {streaming && (!thinking || answer) && (
        <div className="stream-spinner">
          <Spinner />
          <TokPerSec tokPerSec={tokPerSec} />
        </div>
      )}
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

export default function ChatThread({ messages, streamingText, tokPerSec }) {
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
  }, [messages, streamingText]);

  const onScroll = () => {
    stickToBottom.current = isNearBottom();
  };

  // A new message (sent or loaded) should re-engage auto-follow.
  useEffect(() => {
    stickToBottom.current = true;
  }, [messages.length]);

  const visible = messages.filter(
    ({ role, content }) => (role === 'user' || role === 'assistant') && content,
  );

  return (
    <main ref={ref} className="thread" aria-live="polite" onScroll={onScroll}>
      {visible.map((m, i) => (
        <Message key={i} role={m.role} content={m.content} tokPerSec={tokPerSec} />
      ))}
      {streamingText !== null && (
        <Message role="assistant" content={streamingText} streaming tokPerSec={tokPerSec} />
      )}
    </main>
  );
}
