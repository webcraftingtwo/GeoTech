/**
 * Quick-select chips — the primary input device in this application.
 *
 * A chip is a 56px target that takes one tap and cannot be mistyped. Anything
 * that can be a chip instead of a text field, is (§32).
 */
export interface ChipOption {
  code: string;
  label: string;
}

export function ChipGroup({
  label,
  options,
  value,
  onChange,
  allowClear = true,
  tone = 'normal',
}: {
  label?: string;
  options: ChipOption[];
  value?: string | null;
  onChange: (code: string | null) => void;
  allowClear?: boolean;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div>
      {label && <span className="label">{label}</span>}
      <div className="row-wrap">
        {options.map((option) => {
          const selected = value === option.code;
          return (
            <button
              key={option.code}
              type="button"
              className={tone === 'danger' ? 'chip chip-danger' : 'chip'}
              aria-pressed={selected}
              onClick={() => onChange(selected && allowClear ? null : option.code)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
