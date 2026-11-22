export default function EffortMenu({ open, options, value, modelLabel, onChange, onSelectModel }) {
  if (!open) return null;
  const index = Math.max(0, options.findIndex((option) => option.name === value));
  return (
    <div className="selector-popover effort-popover" role="dialog" aria-label="Select effort">
      <div className="effort-panel">
        <div className="effort-heading">
          <div className="effort-value">{options[index].label}</div>
          <button type="button" className="effort-model" onClick={onSelectModel}>{modelLabel || 'Select model'} <span>›</span></button>
        </div>
        <button type="button" className="effort-reset" aria-label="Reset effort to Medium" title="Reset to Medium" onClick={() => onChange('medium')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></svg>
        </button>
        <div className="effort-slider" style={{ '--effort-fill': `${index / (options.length - 1) * 100}%` }}>
          <div className="effort-ticks" aria-hidden="true">{options.map((option) => <span key={option.name} />)}</div>
          <input type="range" min="0" max={options.length - 1} step="1" value={index} aria-label="Reasoning effort" aria-valuetext={options[index].label} onChange={(event) => onChange(options[Number(event.target.value)].name)} />
        </div>
      </div>
    </div>
  );
}
