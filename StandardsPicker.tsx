// ---------------------------------------------------------------------------
// Reusable "Applicable Standards & Regulations" checklist.
//
// Used in two places with the same behavior:
//   - New Project modal (Dashboard.tsx) — pick at creation time
//   - Project Deep Dive — revise after the fact
//
// The picker is scoped to a product segment (Medical Device, Automotive, …).
// Selecting a segment surfaces that segment's catalog from productStandards.
// For free-text / custom segments that aren't in the catalog, we render a
// helpful placeholder instead of an empty list.
//
// The component is controlled — it never owns the selection. Parents pass
// `selected: string[]` and receive changes via `onChange(next)`. This keeps
// the New Project modal's form state + the Deep Dive's Firestore persistence
// both consistent without the picker knowing anything about either context.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { STANDARDS_BY_SEGMENT, type Standard } from './productStandards.ts';

interface StandardsPickerProps {
  // The product segment whose catalog to show. `undefined` or an unknown
  // segment collapses the picker to a friendly "no catalog available" state.
  productSegment?: string;
  // Currently-selected standard codes.
  selected: string[];
  // Emitted when the user toggles or clears selections.
  onChange: (nextCodes: string[]) => void;
  // Collapsed by default (closed). The caller can force-open for the edit
  // flow where we want selections immediately visible.
  defaultOpen?: boolean;
  // Optional compact variant for the Deep Dive settings area — less chrome,
  // smaller padding.
  compact?: boolean;
  disabled?: boolean;
}

const StandardsPicker: React.FC<StandardsPickerProps> = ({
  productSegment,
  selected,
  onChange,
  defaultOpen = false,
  compact = false,
  disabled = false
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const catalog: Standard[] = productSegment
    ? STANDARDS_BY_SEGMENT[productSegment] || []
    : [];
  const selectedSet = new Set(selected);

  const toggle = (code: string) => {
    if (disabled) return;
    if (selectedSet.has(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  const clear = () => {
    if (disabled) return;
    onChange([]);
  };

  const headerRowPadding = compact ? 'px-3 py-2' : 'p-3.5';
  const listRowPadding = compact ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
          Applicable Standards & Regulations
          <span className="ml-2 text-slate-400 font-medium normal-case tracking-normal">
            (optional)
          </span>
        </label>
        {selected.length > 0 && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="flex items-center text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-600 transition-colors"
          >
            <X size={10} className="mr-1" /> Clear ({selected.length})
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || catalog.length === 0}
        className={`w-full flex items-center justify-between border border-slate-200 ${headerRowPadding} font-bold text-sm bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed hover:border-slate-300 transition-colors`}
      >
        <span
          className={
            selected.length === 0 ? 'text-slate-400' : 'text-slate-900'
          }
        >
          {catalog.length === 0
            ? productSegment
              ? `No catalog for "${productSegment}" — skip or add standards later.`
              : 'Pick a product type first to see standards.'
            : selected.length === 0
            ? `Select standards relevant to ${productSegment}`
            : `${selected.length} Standard${
                selected.length > 1 ? 's' : ''
              } Selected`}
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-500 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && catalog.length > 0 && (
        <div className="mt-1 border border-slate-200 border-t-0 bg-white max-h-64 overflow-y-auto">
          {catalog.map((std) => {
            const checked = selectedSet.has(std.code);
            return (
              <button
                key={std.code}
                type="button"
                onClick={() => toggle(std.code)}
                disabled={disabled}
                className={`w-full flex items-start gap-3 text-left ${listRowPadding} border-b border-slate-100 last:border-b-0 transition-colors ${
                  checked
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : 'bg-white hover:bg-slate-50'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <span
                  className={`mt-0.5 w-3.5 h-3.5 border-2 flex-shrink-0 flex items-center justify-center ${
                    checked
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300'
                  }`}
                >
                  {checked && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 6l3 3 5-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-tight text-slate-800">
                    {std.code}
                  </p>
                  <p className="text-[10px] font-medium text-slate-500 mt-0.5 leading-snug">
                    {std.name}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Inline chip preview when collapsed — gives the user a glance at
          what they've picked without re-opening the list. */}
      {!open && selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.slice(0, 6).map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-black uppercase tracking-widest"
            >
              {code}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(code);
                  }}
                  className="text-slate-400 hover:text-red-600 transition-colors"
                  aria-label={`Remove ${code}`}
                >
                  <X size={8} />
                </button>
              )}
            </span>
          ))}
          {selected.length > 6 && (
            <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
              +{selected.length - 6} more
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default StandardsPicker;
