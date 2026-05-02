import React, { useMemo, useState } from 'react';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  HelpCircle
} from 'lucide-react';
import { auth } from './firebase.ts';

interface QuoteCompareToolProps {}

type Verdict = 'attractive' | 'fair' | 'expensive' | 'unknown';
type PriceMode = 'unit' | 'total';

interface ApiResponse {
  verdict: Verdict;
  unitPriceQuoted: number;
  marketLow: number | null;
  marketHigh: number | null;
  currency: string;
  reasoning: string | null;
  sources: string[];
  cached: boolean;
  error?: string;
}

const CATEGORIES = [
  'Labels printing',
  'Injection molded parts',
  'CNC machining',
  'Sheet metal fabrication',
  'PCB fabrication',
  'PCB assembly (PCBA)',
  '3D printing',
  'Wiring harness / cable assembly',
  'Enclosures',
  'Anodizing / surface finish',
  'Packaging',
  'Other'
];

const CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP', 'CNY', 'JPY', 'INR', 'CAD', 'AUD', 'CHF'];

const REGIONS = ['', 'Israel', 'China', 'EU', 'USA', 'India', 'Other'];

// Currency symbol map for the verdict card. Falls back to the ISO code when
// we don't have a glyph — better to show "AUD 1.80" than nothing.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  INR: '₹',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF'
};

function formatPrice(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] || `${currency} `;
  // 2 decimals for normal prices, 0 for clearly bulk/integer numbers (>=100).
  const decimals = amount >= 100 ? 0 : 2;
  const value = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  // For symbols that traditionally trail (none here, but ILS+CHF look fine
  // either way), keep it simple: prefix.
  return `${symbol}${value}`;
}

const QuoteCompareTool: React.FC<QuoteCompareToolProps> = () => {
  // Form state
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [priceMode, setPriceMode] = useState<PriceMode>('unit');
  const [priceInput, setPriceInput] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [region, setRegion] = useState<string>('');
  const [leadTimeDays, setLeadTimeDays] = useState<string>('');
  const [extraNotes, setExtraNotes] = useState<string>('');

  // Submission state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  // Derived: per-unit price when user gave a total, validated.
  const unitPriceComputed = useMemo<number | null>(() => {
    const qty = Number(quantity);
    const price = Number(priceInput);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (!Number.isFinite(price) || price <= 0) return null;
    return priceMode === 'unit' ? price : price / qty;
  }, [priceInput, priceMode, quantity]);

  const canSubmit =
    !isLoading &&
    description.trim().length > 0 &&
    Number(quantity) > 0 &&
    unitPriceComputed !== null &&
    (category !== 'Other' || customCategory.trim().length > 0);

  const handleSubmit = async () => {
    setError(null);
    setResult(null);

    if (!canSubmit || unitPriceComputed === null) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError('You need to be signed in to compare quotes. Please sign in and try again.');
      return;
    }

    let idToken: string;
    try {
      idToken = await currentUser.getIdToken(false);
    } catch {
      setError('Could not retrieve your authentication token. Please sign out and back in.');
      return;
    }

    const effectiveCategory =
      category === 'Other' ? customCategory.trim() : category;

    const payload: Record<string, unknown> = {
      category: effectiveCategory,
      description: description.trim(),
      quantity: Number(quantity),
      unitPrice: unitPriceComputed,
      currency
    };
    if (region) payload.region = region;
    const leadNum = Number(leadTimeDays);
    if (Number.isFinite(leadNum) && leadNum > 0) payload.leadTimeDays = leadNum;
    if (extraNotes.trim()) payload.extraNotes = extraNotes.trim();

    setIsLoading(true);
    try {
      const response = await fetch('/api/quote-compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => ({}))) as ApiResponse & {
        detail?: string;
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setError(
            data?.error ||
              'This tool is admin-only. Sign in with the admin account to continue.'
          );
        } else {
          setError(
            data?.error
              ? `${data.error}${data.detail ? ` — ${data.detail}` : ''}`
              : `API error (${response.status}): ${response.statusText}`
          );
        }
        return;
      }

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // ---- verdict styling helpers --------------------------------------------
  const verdictMeta: Record<
    Verdict,
    {
      label: string;
      bg: string;
      text: string;
      border: string;
      icon: React.ReactNode;
    }
  > = {
    attractive: {
      label: 'Attractive',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      icon: <TrendingDown size={18} className="text-emerald-600" />
    },
    fair: {
      label: 'Fair',
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      icon: <CheckCircle2 size={18} className="text-blue-600" />
    },
    expensive: {
      label: 'Expensive',
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      icon: <TrendingUp size={18} className="text-red-600" />
    },
    unknown: {
      label: 'Inconclusive',
      bg: 'bg-slate-50',
      text: 'text-slate-700',
      border: 'border-slate-200',
      icon: <HelpCircle size={18} className="text-slate-500" />
    }
  };

  // Position the quoted price marker on the range bar (0–100%).
  const markerPct = useMemo<number | null>(() => {
    if (!result) return null;
    const { unitPriceQuoted, marketLow, marketHigh } = result;
    if (marketLow === null || marketHigh === null || marketHigh <= marketLow)
      return null;
    // Pad the visual range by 20% on each side so the marker doesn't slam
    // against the edges when the quote is well outside the market band.
    const span = marketHigh - marketLow;
    const visualLow = marketLow - span * 0.2;
    const visualHigh = marketHigh + span * 0.2;
    const pct =
      ((unitPriceQuoted - visualLow) / (visualHigh - visualLow)) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [result]);

  return (
    <div className="w-full">
      {/* Intro */}
      <div className="mb-6">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 mb-2">
          Compare a supplier quote
        </h3>
        <p className="text-[12px] text-slate-500">
          Enter the quote details below. We benchmark it against current
          market pricing using Gemini with live web search and tell you
          whether it's attractive, fair, or expensive.
        </p>
      </div>

      {/* Form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Category */}
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {category === 'Other' && (
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Specify the category…"
              className="mt-2 w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        {/* Description */}
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Description (material, specs, dimensions, finish)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="e.g. Lexan polycarbonate, 50×30 mm, full-color print, matte laminate"
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Quantity (pcs)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 500"
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Currency */}
        <div>
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Currency
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Price (with unit/total toggle) */}
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700">
              Price
            </label>
            <div className="flex bg-slate-100 rounded p-0.5 text-[10px] font-black uppercase tracking-widest">
              <button
                type="button"
                onClick={() => setPriceMode('unit')}
                className={`px-2 py-1 rounded transition-colors ${
                  priceMode === 'unit'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Per unit
              </button>
              <button
                type="button"
                onClick={() => setPriceMode('total')}
                className={`px-2 py-1 rounded transition-colors ${
                  priceMode === 'total'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Total
              </button>
            </div>
          </div>
          <input
            type="number"
            min={0}
            step="any"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder={
              priceMode === 'unit' ? 'e.g. 1.80 (per piece)' : 'e.g. 650 (total)'
            }
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {/* Live preview of the per-unit price when user gave a total —
              this is the number we send to the backend and the one anchoring
              the comparison, so making it visible up front avoids surprises. */}
          {unitPriceComputed !== null && (
            <p className="mt-1 text-[11px] text-slate-500">
              Per-unit:{' '}
              <span className="font-semibold text-slate-700">
                {formatPrice(unitPriceComputed, currency)}
              </span>{' '}
              · Total:{' '}
              <span className="font-semibold text-slate-700">
                {formatPrice(unitPriceComputed * Number(quantity), currency)}
              </span>
            </p>
          )}
        </div>

        {/* Region */}
        <div>
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Supplier region (optional)
          </label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {REGIONS.map((r) => (
              <option key={r || 'unset'} value={r}>
                {r || '— not specified —'}
              </option>
            ))}
          </select>
        </div>

        {/* Lead time */}
        <div>
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Lead time (days, optional)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(e.target.value)}
            placeholder="e.g. 21"
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Extra notes */}
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700 mb-1">
            Extra notes (optional)
          </label>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={2}
            placeholder="Tooling included? Existing mold? Tight tolerance? Anything that affects price."
            className="w-full border border-slate-300 rounded px-3 py-2 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>
      </div>

      {/* Submit button */}
      <div className="mt-6 pt-6 border-t border-slate-200">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Comparing…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Compare Quote
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-600 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Result card */}
      {result && (
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div
            className={`rounded-lg border p-5 ${verdictMeta[result.verdict].bg} ${verdictMeta[result.verdict].border}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {verdictMeta[result.verdict].icon}
                <span
                  className={`text-sm font-black uppercase tracking-widest ${verdictMeta[result.verdict].text}`}
                >
                  {verdictMeta[result.verdict].label}
                </span>
                {result.cached && (
                  <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                    cached
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                  Quoted unit price
                </div>
                <div className="text-base font-black text-slate-900">
                  {formatPrice(result.unitPriceQuoted, result.currency)}
                </div>
              </div>
            </div>

            {/* Range bar — only when we have both ends */}
            {result.marketLow !== null &&
              result.marketHigh !== null &&
              markerPct !== null && (
                <div className="mb-4">
                  <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                    <span>
                      Market low:{' '}
                      <span className="font-semibold text-slate-800">
                        {formatPrice(result.marketLow, result.currency)}
                      </span>
                    </span>
                    <span>
                      Market high:{' '}
                      <span className="font-semibold text-slate-800">
                        {formatPrice(result.marketHigh, result.currency)}
                      </span>
                    </span>
                  </div>
                  <div className="relative h-3 bg-white rounded-full border border-slate-200 overflow-visible">
                    {/* The market band (low → high) shaded inside the visual
                        range we computed for markerPct. Same 20% padding. */}
                    <div
                      className="absolute top-0 bottom-0 bg-slate-200 rounded-full"
                      style={{ left: '20%', right: '20%' }}
                    />
                    {/* Quote marker */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                      style={{ left: `${markerPct}%` }}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 border-white shadow ${
                          result.verdict === 'attractive'
                            ? 'bg-emerald-500'
                            : result.verdict === 'expensive'
                              ? 'bg-red-500'
                              : 'bg-blue-500'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

            {/* Reasoning */}
            {result.reasoning && (
              <p className="text-[13px] text-slate-700 leading-relaxed">
                {result.reasoning}
              </p>
            )}

            {/* Sources */}
            {result.sources.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-200/70">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  Sources
                </div>
                <ul className="space-y-1">
                  {result.sources.map((url, i) => (
                    <li key={`${url}-${i}`}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-blue-600 hover:text-blue-800 underline break-all"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuoteCompareTool;
