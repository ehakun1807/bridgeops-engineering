# BOM Analyzer Feature Design

**Date**: 2026-04-27  
**Feature**: Electrical component equivalent lookup and form/fit/function analysis

## Overview

The BOM Analyzer allows users to upload an XLSX file containing a list of electrical components (manufacturer name + part number) and automatically finds form/fit/function equivalent components with new part numbers from major distributors (Digi-Key, Mouser).

## Requirements

**Input**:
- XLSX file with exactly 2 columns: `Manufacturer Name` and `Manufacturer Part Number`
- Max file size: 10 MB
- Supports XLSX, XLS, CSV formats

**Output**:
- Real-time analysis results shown in UI as components are looked up
- Downloadable XLSX file with:
  - All original columns
  - New column: `Equivalent Component`
  - New column: `New Manufacturer Part Number`
  - Confidence badge: "Exact Match" vs "Spec-Based Match"

**Matching Strategy** (hierarchical):
1. **Exact substitute**: Same manufacturer, same specs
2. **Category + specs**: Same component type (resistor → resistor, capacitor → capacitor) with matching electrical ratings
3. **Performance equivalent**: Can perform same function, specs may vary slightly
4. Default: Return exact match if found; fallback to spec-based match if no exact match exists

## Architecture

### Components & Services

**Client-Side**:
- `BOMAnalyzerTool.tsx` (enhanced)
  - File upload UI (drag-drop, file selection)
  - Results table showing real-time progress
  - Download button for enriched XLSX
  - Error states for invalid rows

**Server-Side** (Vercel Serverless):
- `api/find-equivalent.ts` — Main lookup service
  - Takes: `manufacturer`, `partNumber` query params
  - Returns: `{ equivalent, newPartNumber, confidence, source }`
  - Implements scraping logic for Digi-Key and Mouser
  - Rate-limited: 1-2s delay between requests to avoid blocking
  - Stores results in cache (Firestore)

**Cache** (Firestore):
- Collection: `componentCache`
- Document: `{manufacturerName}_{partNumber}` (hashed key)
- Fields: `{ equivalent, newPartNumber, confidence, sourceUrl, cachedAt }`
- TTL: 30 days (components don't change frequently)
- Lookup is O(1), prevents redundant scraping

### Data Flow

```
1. User uploads XLSX
   ↓
2. Client parses file, validates columns
   ↓
3. For each row in parallel (5-10 concurrent):
   a. Check cache for {manufacturer, partNumber}
   b. If found → emit to UI immediately
   c. If miss → call /api/find-equivalent (server-side scrape)
   d. Server returns result, stores in cache
   e. Client receives result, updates UI
   ↓
4. User reviews results in real-time table
   ↓
5. User clicks "Download Results"
   ↓
6. Client generates XLSX with original + 2 new columns, downloads
```

## Implementation Details

### File Parsing (Client)
- Use `xlsx` library (already in package.json or add if needed)
- Detect header row (row 1 assumed)
- Validate exactly 2 columns
- Validate no empty cells in data rows
- Return: `Array<{ manufacturer: string, partNumber: string, rowIndex: number }>`

### API Endpoint: `api/find-equivalent.ts`
```typescript
// GET /api/find-equivalent?manufacturer=...&partNumber=...

// Response:
{
  equivalent: string,           // e.g., "1N4148 Diode"
  newPartNumber: string,        // e.g., "1N4148"
  confidence: "exact" | "spec-based",
  source: "digikey" | "mouser",
  sourceUrl: string,
  timestamp: number
}
```

### Scraping Strategy
- **Digi-Key**: Search via product search page, parse product details page
- **Mouser**: Search via parametric search, parse results
- Try Digi-Key first, fallback to Mouser if not found
- Extract: part number, specifications, datasheet (if available)
- Match logic:
  1. Exact part number match
  2. Same category + equivalent specs (voltage, current, tolerance, etc.)
  3. Similar performance characteristics

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Component not found | Show "Not found" in results, mark row in orange |
| Scraper timeout | Retry 2x with exponential backoff (1s, 2s) |
| Rate-limited by distributor | Queue request, try later in batch |
| Malformed input (missing data) | Flag row in red, continue analysis |
| Cache lookup fails | Treat as cache miss, attempt fresh lookup |
| User clears cache | Delete component entries from cache, re-analyze |

### Results Table UI
```
Columns:
- Manufacturer Name (original)
- Manufacturer Part Number (original)
- Status: 🔄 Searching / ✅ Found / ❌ Not found
- Equivalent Component (new)
- New Part Number (new)
- Confidence: "Exact Match" badge or "Spec-Based"
```

### Download Output
- Format: XLSX
- Filename: `BOM_Analysis_{timestamp}.xlsx`
- Rows: Original data + 2 new columns
- Columns: [Original columns 1-2] + [Equivalent Component] + [New Part Number]
- Optional: Add "Confidence" column to show match quality

## Edge Cases & Limitations

1. **Multiple equivalents**: Return top match (highest confidence)
2. **Obsolete components**: Note if component is EOL on distributors
3. **Regional differences**: Search US-based distributors (Digi-Key, Mouser)
4. **Custom/proprietary parts**: Will not find equivalents, flag as "Not found"
5. **Typos in input**: Best-effort matching; may return no result if manufacturer name is heavily misspelled

## Testing

### Unit Tests
- File parsing: valid/invalid XLSX, missing columns, empty rows
- Cache lookup: hit/miss scenarios, expired entries
- API response validation: malformed responses, missing fields

### Integration Tests
- End-to-end: upload file → analyze → download
- Real distributor lookups (with mock data for CI/CD)
- Concurrent requests: 5-10 parallel analyses
- Error scenarios: timeout, not found, rate-limit

### Manual Testing
- Small BOM (5 rows): verify real-time results
- Large BOM (100+ rows): verify performance, rate-limiting
- Download XLSX: verify structure, data accuracy

## Performance Considerations

- **Cache hit latency**: <100ms
- **Cache miss latency**: 5-15s per component (depends on distributor responsiveness)
- **Parallel limit**: 5-10 concurrent requests (avoid rate-limiting)
- **Total analysis time**: ~30-60s for 100 components (mix of hits/misses)

## Dependencies

**Client**:
- `xlsx` library (for XLSX parsing)
- Existing: React, Tailwind, Lucide icons

**Server**:
- `cheerio` or `puppeteer` (for web scraping)
- Firebase/Firestore (for caching)
- Existing: Vercel serverless runtime

## Future Enhancements

1. **Batch API**: Upload larger BOMs (1000+ components)
2. **Alternative distributors**: Add Arrow, SemieeOnline, etc.
3. **Price lookup**: Show pricing from distributors
4. **Lead time**: Show availability and lead times
5. **Historical tracking**: Store analysis results per project
6. **User preferences**: Save preferred equivalent sources
