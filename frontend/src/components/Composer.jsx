import { useRef } from 'react';
import { useAutosize } from '../hooks/useAutosize.js';

export default function Composer({ value, onChange, onSend, phase, disabled, onStop }) {
  const area = useRef(null);
  useAutosize(area, value);

  const hasText = value.trim() !== '';
  const showStop = phase !== 'idle';

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasText || disabled || showStop) return;
        onSend(value.trim());
      }}
    >
      <button type="button" className="attach" aria-label="Attach" title="Attach (coming soon)" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <textarea
        ref={area}
        rows={1}
        placeholder="Write a message..."
        aria-label="Write a message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form.requestSubmit();
          }
        }}
      />
      <button type="submit" className="send" aria-label="Send" hidden={showStop} disabled={disabled || !hasText}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      </button>
      {!showStop ? null : (
        <button type="button" className="stop" aria-label={phase === 'stopping' ? 'Stopping response' : 'Stop response'}
          disabled={phase === 'stopping'} onClick={onStop}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="none" fill="currentColor" />
          </svg>
        </button>
      )}
    </form>
  );
}
