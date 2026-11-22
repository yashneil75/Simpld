import { CHECK } from './icons.jsx';

export default function ModelMenu({ open, tiers, current, onSelect, label = 'Model', heading = 'Select model' }) {
  if (!open) return null;
  return (
    <div className="model-menu menu selector-popover">
      <div className="selector-heading">{heading}</div>
      <div className="selector-model-list" role="menu" aria-label={label}>
      {tiers.map(({ name, label }) => (
        <button
          key={name}
          type="button"
          className="menu-option"
          role="menuitemradio"
          aria-checked={String(name === current)}
          onClick={() => onSelect(name)}
        >
          <span className="opt-text">
            <span className="opt-name">{label}</span>
          </span>
          {CHECK}
        </button>
      ))}
      </div>
    </div>
  );
}
