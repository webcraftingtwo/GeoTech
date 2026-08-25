import { useState } from 'react';

/**
 * Numeric entry (§32).
 *
 * The device keyboard is not used for measurements: it is small, it puts digits
 * behind a mode switch, and it hides half the screen. This keypad is fixed,
 * large, and always shows the value being edited.
 */
export function NumericKeypad({
  value,
  onChange,
  onNext,
  allowNegative = false,
  nextLabel = 'NEXT',
}: {
  value: string;
  onChange: (value: string) => void;
  onNext?: () => void;
  allowNegative?: boolean;
  nextLabel?: string;
}) {
  const press = (key: string) => {
    if (key === 'back') return onChange(value.slice(0, -1));
    if (key === 'clear') return onChange('');
    if (key === '−') {
      if (!allowNegative) return;
      return onChange(value.startsWith('-') ? value.slice(1) : `-${value}`);
    }
    if (key === '.') return onChange(value.includes('.') ? value : `${value === '' ? '0' : value}.`);
    return onChange(value === '0' ? key : value + key);
  };

  return (
    <div className="keypad">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((k) => (
        <button key={k} type="button" onClick={() => press(k)}>
          {k}
        </button>
      ))}
      <button type="button" onClick={() => press(allowNegative ? '−' : 'clear')} className={allowNegative ? undefined : 'subtle'}>
        {allowNegative ? '−' : 'CLEAR'}
      </button>
      <button type="button" onClick={() => press('0')}>
        0
      </button>
      <button type="button" onClick={() => press('.')}>
        .
      </button>
      <button type="button" className="subtle" onClick={() => press('clear')}>
        CLEAR
      </button>
      <button type="button" onClick={() => press('back')}>
        ⌫
      </button>
      <button type="button" className="accent" onClick={onNext} disabled={!onNext}>
        {nextLabel}
      </button>
    </div>
  );
}

/** A labelled measurement with its own keypad, opened on tap. */
export function MeasurementField({
  label,
  unit,
  value,
  onChange,
  allowNegative = false,
  hint,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="readout" data-active={open} onClick={() => setOpen((o) => !o)} style={{ width: '100%' }}>
        <div style={{ textAlign: 'left', flex: 1 }}>
          <span className="label">{label}</span>
          <span className="value-lg">{value === '' ? '—' : value}</span>
          {unit && <span className="muted" style={{ marginLeft: 8 }}>{unit}</span>}
        </div>
        <span className="muted small">{open ? 'DONE' : 'TAP'}</span>
      </button>
      {hint && <span className="small muted">{hint}</span>}
      {open && <NumericKeypad value={value} onChange={onChange} onNext={() => setOpen(false)} allowNegative={allowNegative} nextLabel="DONE" />}
    </div>
  );
}
