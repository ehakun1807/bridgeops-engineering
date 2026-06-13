// ---------------------------------------------------------------------------
// ProjectSearchModal.tsx
//
// Cmd+K project-scoped search — queries all tool Firestore collections for the
// current project, filters client-side, groups results by tool, and calls
// onNavigate(tabId) when the user selects a result.
//
// Entity aliases (orgSettings/{userId}.entityAliases) expand search terms so
// "ACME" matches "ACME Corp" and "Acme Electronics" automatically.
//
// Collections searched:
//   taktStudies, meetings, pfmeas, processMaps, productBoms,
//   decisions, lessons, controlPlans, projectBudgets (single-doc)
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  X,
  ChevronRight,
  Clock,
  Loader2,
  BarChart2,
  Users,
  ShieldAlert,
  GitBranch,
  Package,
  Scale,
  Lightbulb,
  ClipboardList,
  Wallet,
  FlaskConical,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  Firestore,
} from 'firebase/firestore';
import { loadEntityAliases, EntityAliasMap } from './orgAliasesClient.ts';

// ---------------------------------------------------------------------------
// Tab IDs (mirrors ProjectDeepDive constants)
// ---------------------------------------------------------------------------
const TAB = {
  STUDIES:      '__studies__',
  MEETINGS:     '__meetings__',
  PFMEA:        '__pfmea__',
  PROCESS_MAP:  '__process_map__',
  BOM:          '__product_bom__',
  DECISIONS:    '__decisions__',
  LESSONS:      '__lessons__',
  CONTROL_PLAN: '__control_plan__',
  BUDGET:       '__budget__',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  tabId: string;
  toolLabel: string;
  icon: React.ReactNode;
  title: string;
  snippet: string;
  /** Firestore doc ID — not used for navigation v1, kept for future deep-link */
  docId: string;
}

interface ToolConfig {
  tabId: string;
  label: string;
  icon: React.ReactNode;
  collection: string;
  /** Fields to index for keyword matching */
  textFields: string[];
  /** Best display title field(s) (first non-empty wins) */
  titleFields: string[];
  /** Build a snippet from a raw Firestore data object */
  snippetBuilder?: (data: Record<string, unknown>) => string;
}

const TOOL_CONFIGS: ToolConfig[] = [
  {
    tabId: TAB.STUDIES,
    label: 'Studies',
    icon: <FlaskConical size={13} />,
    collection: 'taktStudies',
    titleFields: ['studyName'],
    textFields: ['studyName', 'comment'],
    snippetBuilder: (d) => {
      const parts: string[] = [];
      if (d.comment) parts.push(String(d.comment).slice(0, 80));
      if (d.status) parts.push(String(d.status));
      return parts.join(' · ');
    },
  },
  {
    tabId: TAB.MEETINGS,
    label: 'Meetings',
    icon: <Users size={13} />,
    collection: 'meetings',
    titleFields: ['scope'],
    textFields: ['scope', 'attendees', 'notes', 'actionItems'],
    snippetBuilder: (d) => {
      const parts: string[] = [];
      if (d.attendees) parts.push(String(d.attendees).slice(0, 60));
      if (d.notes) parts.push(String(d.notes).slice(0, 60));
      return parts.join(' · ');
    },
  },
  {
    tabId: TAB.PFMEA,
    label: 'PFMEA',
    icon: <ShieldAlert size={13} />,
    collection: 'pfmeas',
    titleFields: ['title'],
    textFields: ['title', 'scope', 'participants'],
    snippetBuilder: (d) => {
      const risks = (d.risks as Array<Record<string, unknown>> | undefined) || [];
      const topRisk = risks[0];
      if (topRisk?.failureMode) return `Risk: ${String(topRisk.failureMode).slice(0, 80)}`;
      if (d.scope) return String(d.scope).slice(0, 80);
      return '';
    },
  },
  {
    tabId: TAB.PROCESS_MAP,
    label: 'Process Map',
    icon: <GitBranch size={13} />,
    collection: 'processMaps',
    titleFields: ['title'],
    textFields: ['title', 'description'],
    snippetBuilder: (d) => {
      const steps = (d.steps as Array<Record<string, unknown>> | undefined) || [];
      if (d.description) return String(d.description).slice(0, 80);
      if (steps.length) return `${steps.length} step${steps.length === 1 ? '' : 's'}`;
      return '';
    },
  },
  {
    tabId: TAB.BOM,
    label: 'ECO Pulse',
    icon: <Package size={13} />,
    collection: 'productBoms',
    titleFields: ['versionLabel', 'fileName'],
    textFields: ['versionLabel', 'reasonForChange', 'fileName'],
    snippetBuilder: (d) => {
      if (d.reasonForChange) return String(d.reasonForChange).slice(0, 80);
      if (d.fileName) return String(d.fileName);
      return '';
    },
  },
  {
    tabId: TAB.DECISIONS,
    label: 'Decision Ledger',
    icon: <Scale size={13} />,
    collection: 'decisions',
    titleFields: ['title'],
    textFields: ['title', 'description', 'rationale', 'relatedRisks', 'impact'],
    snippetBuilder: (d) => {
      if (d.rationale) return String(d.rationale).slice(0, 80);
      if (d.description) return String(d.description).slice(0, 80);
      return '';
    },
  },
  {
    tabId: TAB.LESSONS,
    label: 'Lessons',
    icon: <Lightbulb size={13} />,
    collection: 'lessons',
    titleFields: ['title'],
    textFields: ['title', 'description', 'rootCause'],
    snippetBuilder: (d) => {
      if (d.rootCause) return `Root cause: ${String(d.rootCause).slice(0, 70)}`;
      if (d.description) return String(d.description).slice(0, 80);
      return '';
    },
  },
  {
    tabId: TAB.CONTROL_PLAN,
    label: 'Control Plan',
    icon: <ClipboardList size={13} />,
    collection: 'controlPlans',
    titleFields: ['title'],
    textFields: ['title', 'partDescription', 'participants'],
    snippetBuilder: (d) => {
      const items = (d.items as Array<Record<string, unknown>> | undefined) || [];
      const critical = items.filter((i) => i.specialClass === 'critical').length;
      const parts: string[] = [];
      if (d.partDescription) parts.push(String(d.partDescription).slice(0, 60));
      if (critical > 0) parts.push(`${critical} critical char.`);
      return parts.join(' · ');
    },
  },
  {
    tabId: TAB.BUDGET,
    label: 'Budget Tracker',
    icon: <Wallet size={13} />,
    collection: 'projectBudgets',
    titleFields: [],
    textFields: [],
    snippetBuilder: () => '',
  },
];

// For Budget the doc is keyed by projectId (single doc), handled specially below.
const BUDGET_COLLECTION = 'projectBudgets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;/|()\[\]]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Expands a set of query tokens by including entity alias terms.
 * If a token matches any canonical name or alias, all related names are added.
 */
function expandWithAliases(tokens: string[], aliases: EntityAliasMap): string[] {
  const expanded = new Set<string>(tokens);
  for (const [canonical, aliasList] of Object.entries(aliases)) {
    const allNames = [canonical, ...aliasList].map((n) => n.toLowerCase());
    const hasOverlap = tokens.some((t) => allNames.some((n) => n.includes(t) || t.includes(n)));
    if (hasOverlap) {
      allNames.forEach((n) => tokenize(n).forEach((tok) => expanded.add(tok)));
    }
  }
  return Array.from(expanded);
}

function matchesTokens(text: string | undefined | null, tokens: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

/**
 * Check if a Firestore doc matches ALL query tokens across specified text fields.
 * Also searches inside PFMEA risks array and BOM lines array.
 */
function docMatches(
  data: Record<string, unknown>,
  textFields: string[],
  tokens: string[],
): boolean {
  // Flat fields
  for (const field of textFields) {
    const val = data[field];
    if (typeof val === 'string' && matchesTokens(val, tokens)) return true;
  }

  // PFMEA risks sub-array
  const risks = data.risks as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(risks)) {
    for (const risk of risks) {
      for (const key of ['processStep', 'failureMode', 'failureEffect', 'cause', 'controls']) {
        if (matchesTokens(risk[key] as string | undefined, tokens)) return true;
      }
    }
  }

  // BOM lines sub-array
  const lines = data.lines as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      for (const key of ['internalPn', 'mpn', 'manufacturer', 'description', 'refDes']) {
        if (matchesTokens(line[key] as string | undefined, tokens)) return true;
      }
    }
  }

  // Budget cost lines
  const budgetLines = data.lines as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(budgetLines)) {
    for (const line of budgetLines) {
      if (matchesTokens(line.description as string | undefined, tokens)) return true;
    }
  }

  return false;
}

function buildTitle(data: Record<string, unknown>, titleFields: string[]): string {
  for (const f of titleFields) {
    const v = data[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'Untitled';
}

function highlightSnippet(snippet: string, tokens: string[]): string {
  // Return as-is; highlighting is done via CSS in render
  return snippet;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProjectSearchModalProps {
  projectId: string;
  userId: string;
  projectName: string;
  db: Firestore;
  onClose: () => void;
  onNavigate: (tabId: string, docId?: string) => void;
}

const ProjectSearchModal: React.FC<ProjectSearchModalProps> = ({
  projectId,
  userId,
  projectName,
  db,
  onClose,
  onNavigate,
}) => {
  const [query2, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [aliases, setAliases] = useState<EntityAliasMap>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load entity aliases once
  useEffect(() => {
    loadEntityAliases(db, userId).then(setAliases).catch(() => {});
  }, [db, userId]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onNavigate(result.tabId, result.docId);
      onClose();
    },
    [onNavigate, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Run search when query changes (debounced 200ms)
  useEffect(() => {
    const raw = query2.trim();
    if (raw.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    const tokens = expandWithAliases(tokenize(raw), aliases);

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const allResults: SearchResult[] = [];

        for (const config of TOOL_CONFIGS) {
          if (config.collection === BUDGET_COLLECTION) {
            // Budget is a single doc keyed by projectId
            try {
              const snap = await getDoc(doc(db, BUDGET_COLLECTION, projectId));
              if (snap.exists()) {
                const data = snap.data() as Record<string, unknown>;
                const lines = (data.lines as Array<Record<string, unknown>> | undefined) || [];
                // Search budget lines
                const matchingLines = lines.filter((line) =>
                  matchesTokens(line.description as string | undefined, tokens)
                );
                if (matchingLines.length > 0) {
                  allResults.push({
                    tabId: config.tabId,
                    toolLabel: config.label,
                    icon: config.icon,
                    title: 'Budget Tracker',
                    snippet: `${matchingLines.length} cost line${matchingLines.length === 1 ? '' : 's'} matched — ${String(matchingLines[0].description || '').slice(0, 60)}`,
                    docId: projectId,
                  });
                }
              }
            } catch {
              // non-fatal
            }
            continue;
          }

          try {
            const colRef = collection(db, config.collection);
            const q = query(
              colRef,
              where('userId', '==', userId),
              where('projectId', '==', projectId)
            );
            const snap = await getDocs(q);
            for (const docSnap of snap.docs) {
              const data = docSnap.data() as Record<string, unknown>;
              if (!docMatches(data, config.textFields, tokens)) continue;

              const title = buildTitle(data, config.titleFields);
              const snippet = config.snippetBuilder ? config.snippetBuilder(data) : '';

              allResults.push({
                tabId: config.tabId,
                toolLabel: config.label,
                icon: config.icon,
                title,
                snippet,
                docId: docSnap.id,
              });
            }
          } catch {
            // non-fatal — tool collection might not exist yet
          }
        }

        if (!cancelled) {
          setResults(allResults);
          setHasSearched(true);
          setSelectedIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query2, projectId, userId, db, aliases]);

  // Group results by tool
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.toolLabel]) acc[r.toolLabel] = [];
    acc[r.toolLabel].push(r);
    return acc;
  }, {});

  // Flat list for keyboard nav (index matches selectedIndex)
  // (already flat in `results`)

  const modal = (
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-center pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="relative z-[9999] w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
        style={{ maxHeight: '70vh' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          {loading ? (
            <Loader2 size={16} className="text-slate-400 animate-spin flex-shrink-0" />
          ) : (
            <Search size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query2}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Search ${projectName}…`}
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent"
          />
          {query2 && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="text-[10px] text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 flex-shrink-0">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 56px)' }}>
          {query2.trim().length < 2 && (
            <div className="px-5 py-8 text-center">
              <Search size={24} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">
                Type to search across all tools for this project
              </p>
              <p className="text-xs text-slate-300 mt-1">
                Meetings, Decisions, PFMEA, Studies, BOM, Lessons, and more
              </p>
            </div>
          )}

          {query2.trim().length >= 2 && !loading && hasSearched && results.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-slate-500">No results for "{query2.trim()}"</p>
              <p className="text-xs text-slate-400 mt-1">
                Try different keywords or check another tool directly
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="py-1">
              {(Object.entries(grouped) as [string, SearchResult[]][]).map(([toolLabel, toolResults]) => (
                <div key={toolLabel}>
                  {/* Tool group header */}
                  <div className="px-4 py-1.5 flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {toolLabel}
                    </span>
                    <span className="text-[10px] text-slate-300">
                      {toolResults.length} result{toolResults.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Results */}
                  {toolResults.map((result) => {
                    const flatIdx = results.indexOf(result);
                    const isSelected = flatIdx === selectedIndex;
                    return (
                      <button
                        key={result.docId + result.tabId}
                        data-idx={flatIdx}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className={`mt-0.5 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}>
                          {result.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                            {result.title}
                          </p>
                          {result.snippet && (
                            <p className="text-xs text-slate-400 truncate mt-0.5">
                              {result.snippet}
                            </p>
                          )}
                        </div>
                        <ChevronRight
                          size={12}
                          className={`flex-shrink-0 mt-1 transition-opacity ${isSelected ? 'opacity-100 text-blue-400' : 'opacity-0'}`}
                        />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Footer hint */}
          {results.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-3 text-[10px] text-slate-400">
              <span><kbd className="bg-slate-100 border border-slate-200 rounded px-1">↑↓</kbd> navigate</span>
              <span><kbd className="bg-slate-100 border border-slate-200 rounded px-1">↵</kbd> open tool</span>
              <span><kbd className="bg-slate-100 border border-slate-200 rounded px-1">esc</kbd> close</span>
              <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );

  return ReactDOM.createPortal(
    <AnimatePresence>{modal}</AnimatePresence>,
    document.body
  );
};

export default ProjectSearchModal;
