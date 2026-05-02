import React, { useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  Upload,
  Paperclip,
  X,
  FileText,
  FileImage,
  FileCode2
} from 'lucide-react';
import { auth } from './firebase.ts';

interface QuoteCompareToolProps {}

type Verdict = 'attractive' | 'fair' | 'expensive' | 'unknown';
type PriceMode = 'unit' | 'total';

// Attachment types — must match the server's expected shape in
// /api/quote-compare. `inline` files are base64-encoded binaries that go
// to Gemini as inline_data parts (PDFs, images). `text` files are read as
// plain text and folded into the prompt (CAD/Gerber/drill text formats).
type AttachmentKind = 'inline' | 'text';

interface PreparedAttachment {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  mimeType: string;
  // For inline: raw base64 (no data: prefix). For text: the file's text.
  data: string;
}

// Gemini multimodal supports these binary types directly.
const INLINE_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

// Text-class formats we handle by reading content and pasting it into the
// prompt. Covered: STEP/STP CAD, Gerber + Excellon drill, generic text.
const TEXT_EXTENSIONS = new Set([
  '.stp', '.step',
  '.gbrjob', '.gbr', '.ger',
  '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gko',
  '.drl', '.xln', '.tap', '.nc',
  '.txt', '.csv', '.tsv', '.json', '.log', '.md'
]);

// Per-file and total caps. Vercel's serverless body limit is ~4.5MB; base64
// inflates by ~33%, so 8MB raw total → ~10.7MB JSON which is too big. We
// keep total raw at 5MB to stay safely under the limit while accommodating
// a typical quote PDF (~1-2MB) plus a STEP file (~1-3MB).
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
// Cap text content per file when included in the prompt — STEP files can
// be huge but the first ~60KB carries enough header / structure for the
// model to reason about complexity. Beyond that we'd just burn tokens.
const MAX_TEXT_CHARS = 60_000;

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function attachmentIcon(att: PreparedAttachment): React.ReactNode {
  if (att.mimeType.startsWith('image/'))
    return <FileImage size={16} className="text-blue-600" />;
  if (att.mimeType === 'application/pdf')
    return <FileText size={16} className="text-red-600" />;
  if (att.kind === 'text') return <FileCode2 size={16} className="text-emerald-600" />;
  return <Paperclip size={16} className="text-slate-500" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // readAsDataURL returns "data:<mime>;base64,<data>". Strip the prefix
      // — server expects pure base64.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

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

  // Attachments state
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalAttachedBytes = useMemo(
    () => attachments.reduce((sum, a) => sum + a.size, 0),
    [attachments]
  );

  // Process a list of files dropped/picked. Skips unsupported types with a
  // visible reason, and short-circuits if any single file or the running
  // total exceeds the size cap so the user gets a clear error before we
  // burn time reading.
  const handleFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    setIsReadingFile(true);

    const incoming = Array.from(files);
    const skipped: string[] = [];
    let runningTotal = totalAttachedBytes;

    const newOnes: PreparedAttachment[] = [];

    for (const file of incoming) {
      const ext = getExtension(file.name);
      const mime = (file.type || '').toLowerCase();

      // ZIP not yet supported — surface a specific message instead of a
      // generic "unsupported" so the user knows the recipe.
      if (
        ext === '.zip' ||
        mime === 'application/zip' ||
        mime === 'application/x-zip-compressed'
      ) {
        skipped.push(
          `${file.name}: ZIP not yet supported — extract and upload individual files`
        );
        continue;
      }

      let kind: AttachmentKind | null = null;
      let mimeForRequest = mime;
      if (INLINE_MIME_TYPES.has(mime)) {
        kind = 'inline';
      } else if (TEXT_EXTENSIONS.has(ext)) {
        kind = 'text';
        mimeForRequest = 'text/plain';
      } else if (mime.startsWith('image/')) {
        // Image variants we don't list explicitly (gif/heic/etc) — Gemini
        // tolerates png/jpeg/webp. Reject others up front.
        skipped.push(
          `${file.name}: image type ${mime} not supported — use PNG, JPEG, or WEBP`
        );
        continue;
      } else {
        skipped.push(
          `${file.name}: unsupported type — use PDF, image, or text/CAD format`
        );
        continue;
      }

      if (file.size > MAX_FILE_BYTES) {
        skipped.push(
          `${file.name}: ${formatFileSize(file.size)} exceeds per-file limit ${formatFileSize(MAX_FILE_BYTES)}`
        );
        continue;
      }
      if (runningTotal + file.size > MAX_TOTAL_BYTES) {
        skipped.push(
          `${file.name}: would exceed total ${formatFileSize(MAX_TOTAL_BYTES)} cap`
        );
        continue;
      }

      try {
        let data: string;
        if (kind === 'inline') {
          data = await readAsBase64(file);
        } else {
          const text = await readAsText(file);
          // Truncate very large text files; STEP/Gerber easily exceed token
          // budgets if we send them whole.
          data =
            text.length > MAX_TEXT_CHARS
              ? text.slice(0, MAX_TEXT_CHARS) +
                `\n\n[TRUNCATED — file is ${text.length} chars, sent first ${MAX_TEXT_CHARS}]`
              : text;
        }
        const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        newOnes.push({
          id,
          name: file.name,
          size: file.size,
          kind,
          mimeType: mimeForRequest || 'application/octet-stream',
          data
        });
        runningTotal += file.size;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push(`${file.name}: ${msg}`);
      }
    }

    if (newOnes.length > 0) {
      setAttachments((prev) => [...prev, ...newOnes]);
    }
    if (skipped.length > 0) {
      setUploadError(skipped.join('\n'));
    }
    setIsReadingFile(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.currentTarget.files && e.currentTarget.files.length > 0) {
      void handleFiles(e.currentTarget.files);
    }
    // Allow re-uploading the same file by clearing the input value.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

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

    if (attachments.length > 0) {
      // Wire attachments through to the API. The server validates again —
      // this is convenience-shaping only, not a security boundary.
      payload.attachments = attachments.map((a) => ({
        name: a.name,
        kind: a.kind,
        mimeType: a.mimeType,
        data: a.data
      }));
    }

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

      {/* Attachments — optional supplementary context for the model */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-700">
            Attachments (optional)
          </label>
          <span className="text-[10px] uppercase tracking-widest text-slate-400">
            {formatFileSize(totalAttachedBytes)} / {formatFileSize(MAX_TOTAL_BYTES)}
          </span>
        </div>
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-all cursor-pointer ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-300 hover:border-slate-400 bg-slate-50'
          }`}
        >
          <Upload
            size={20}
            className={`mx-auto mb-1 ${dragActive ? 'text-blue-600' : 'text-slate-400'}`}
          />
          <p className="text-[12px] text-slate-700">
            {isReadingFile
              ? 'Reading file…'
              : 'Drop quote PDF, photos, STEP, or Gerber files — or click to browse'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            PDF · PNG/JPG/WEBP · STEP · GBR/GTL/GBL/etc · DRL · TXT/CSV · max{' '}
            {formatFileSize(MAX_FILE_BYTES)} per file
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInput}
            className="hidden"
            aria-label="Attach files for context"
            // We deliberately don't set `accept` — extension/MIME is varied
            // (Gerbers don't have standard MIMEs) and an over-restrictive
            // accept list silently hides files the user is trying to pick.
            // We validate types after selection in handleFiles().
          />
        </div>

        {/* Per-file errors / skips from the last batch */}
        {uploadError && (
          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 whitespace-pre-line">
            {uploadError}
          </div>
        )}

        {/* Selected file chips */}
        {attachments.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded text-[12px]"
              >
                {attachmentIcon(att)}
                <span className="flex-1 min-w-0 truncate text-slate-800">
                  {att.name}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 whitespace-nowrap">
                  {att.kind === 'inline' ? 'binary' : 'text'} ·{' '}
                  {formatFileSize(att.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="p-0.5 hover:bg-slate-100 rounded"
                  aria-label={`Remove ${att.name}`}
                >
                  <X size={14} className="text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
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
