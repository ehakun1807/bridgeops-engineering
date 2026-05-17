// ---------------------------------------------------------------------------
// CrossCheckBanner — Layer 2 inline alert.
//
// Shown inside a tool (PFMEATool, DecisionLedgerTool, ProductBomTool) when a
// proactive cross-check detects a conflict between this tool's latest save and
// data in another tool. Dismissable; non-interrupting amber style.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { CrossCheckResult } from './crossCheckEngine.ts';

interface CrossCheckBannerProps {
  result: CrossCheckResult;
  onDismiss: () => void;
}

const CrossCheckBanner: React.FC<CrossCheckBannerProps> = ({ result, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-4 border-amber-500 bg-amber-50 rounded-sm overflow-hidden">
      {/* Top row — always visible */}
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle
          size={15}
          className="flex-shrink-0 text-amber-600 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-wide text-amber-800 leading-snug">
            {result.headline}
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            {result.detail}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {result.matches.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-amber-600 hover:text-amber-800 p-1 rounded transition-colors"
              title={expanded ? 'Hide details' : 'Show details'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="text-amber-500 hover:text-amber-800 p-1 rounded transition-colors"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Expanded match list */}
      {expanded && result.matches.length > 0 && (
        <div className="border-t border-amber-200 px-4 py-2 space-y-1.5">
          {result.matches.map((m, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[11px] font-bold text-amber-900">{m.label}</span>
              <span className="text-[10px] text-amber-700">{m.snippet}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CrossCheckBanner;
