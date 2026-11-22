import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ ask, onResolve }) {
  const ref = useRef(null);
  const never = useRef(null);

  useEffect(() => {
    if (ask) {
      if (never.current) never.current.checked = false;
      ref.current.returnValue = '';
      if (!ref.current.open) ref.current.showModal();
    } else {
      ref.current?.close();
    }
  }, [ask]);

  return (
    <dialog
      ref={ref}
      className="ask"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onClose={() => onResolve(ref.current?.returnValue === 'delete', never.current?.checked)}
    >
      <form method="dialog">
        <h2 id="confirm-title">{ask?.title}</h2>
        <p id="confirm-body">{ask?.text}</p>
        {ask?.allowOptOut && (
          <label className="ask-opt">
            <input ref={never} type="checkbox" />
            Never show me this again
          </label>
        )}
        <div className="ask-actions">
          <button type="submit" value="cancel" autoFocus>
            Cancel
          </button>
          <button type="submit" className="ask-delete" value="delete">
            Delete
          </button>
        </div>
      </form>
    </dialog>
  );
}
