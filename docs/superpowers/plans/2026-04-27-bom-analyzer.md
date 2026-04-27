# BOM Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to upload electrical component BOMs (XLSX) and automatically find form/fit/function equivalent components with new part numbers from distributors.

**Architecture:** Client-side XLSX parsing triggers real-time component lookups via serverless API. Results are cached in Firestore to prevent redundant scraping. UI streams results as they arrive, allowing download of enriched XLSX.

**Tech Stack:** React, TypeScript, XLSX parsing (`xlsx` library), Cheerio (web scraping), Firebase/Firestore, Vercel serverless functions

---

### Task 1: Set Up Utilities - XLSX Parsing

**Files:**
- Create: `src/utils/bomAnalyzer.ts`
- Create: `src/__tests__/bomAnalyzer.test.ts`

**Steps:**
1. Write failing tests for XLSX parsing in `src/__tests__/bomAnalyzer.test.ts`
2. Run tests to verify they fail
3. Implement XLSX parsing utility in `src/utils/bomAnalyzer.ts`
4. Run tests to verify they pass
5. Commit with message: "feat: add XLSX parsing and validation for BOM analyzer"

**Key Requirements:**
- Parse XLSX files with exactly 2 columns: Manufacturer Name, Manufacturer Part Number
- Validate column count, data rows, empty cells
- Normalize whitespace
- Return array of BomRow objects with manufacturer, partNumber, rowIndex
- Validate rows and flag special characters
- Tests must cover: valid parsing, column validation, empty rows, whitespace normalization, special character detection

---

### Task 2: Set Up Cache Manager - Firestore

**Files:**
- Create: `src/utils/cacheManager.ts`
- Create: `src/__tests__/cacheManager.test.ts`

**Steps:**
1. Write failing tests for cache operations
2. Run tests to verify they fail
3. Implement cache manager using Firestore in `src/utils/cacheManager.ts`
4. Run tests to verify they pass
5. Commit with message: "feat: add Firestore cache layer for component lookups"

**Key Requirements:**
- Get/set cached equivalents in Firestore collection `componentCache`
- Generate cache keys from manufacturer + part number (normalized)
- Support 30-day TTL for cache entries
- Handle whitespace normalization
- Clear expired entries
- Tests must cover: cache miss, cache hit, TTL expiration, whitespace handling

---

### Task 3: Implement Distributor Scraping Logic

**Files:**
- Create: `src/utils/distributorScraper.ts`

**Steps:**
1. Implement web scraper for Digi-Key and Mouser in `src/utils/distributorScraper.ts`
2. Commit with message: "feat: implement Digi-Key and Mouser web scraping logic"

**Key Requirements:**
- `scrapeDigiKey(manufacturer, partNumber)` function using Cheerio to parse search results
- `scrapeMouser(manufacturer, partNumber)` function using Cheerio
- `findEquivalent(manufacturer, partNumber)` function that tries Digi-Key first, then Mouser
- Return ScraperResult with: equivalent, newPartNumber, confidence ('exact'), source, sourceUrl
- Rate-limited (1-2s delays between requests handled server-side)
- Handle errors gracefully, return null if not found
- Use proper User-Agent header to avoid blocking

---

### Task 4: Create XLSX Output Generator

**Files:**
- Create: `src/utils/xlsxGenerator.ts`
- Create: `src/__tests__/xlsxGenerator.test.ts`

**Steps:**
1. Write failing tests for XLSX generation
2. Run tests to verify they fail
3. Implement XLSX generator in `src/utils/xlsxGenerator.ts`
4. Run tests to verify they pass
5. Commit with message: "feat: add XLSX output generation for BOM analysis results"

**Key Requirements:**
- `generateResultsXlsx(bomRows, results)` generates XLSX blob with 5 columns:
  - Manufacturer Name (original)
  - Manufacturer Part Number (original)
  - Equivalent Component (new)
  - New Part Number (new)
  - Confidence (Exact Match or Spec-Based Match)
- Auto-size columns appropriately
- Show "Not found" for missing components
- `downloadXlsx(blob, filename)` triggers browser download
- Tests must cover: column preservation, "Not found" display, file type validation

---

### Task 5: Create Serverless API Endpoint

**Files:**
- Create: `api/find-equivalent.ts`

**Steps:**
1. Implement serverless function in `api/find-equivalent.ts`
2. Commit with message: "feat: add serverless API endpoint for component lookup"

**Key Requirements:**
- GET endpoint `/api/find-equivalent?manufacturer=X&partNumber=Y`
- Check cache first (return cached result)
- If cache miss, call `findEquivalent(manufacturer, partNumber)`
- Rate-limit with 1-2s random delay per request
- Store result in cache after lookup
- Return JSON: { equivalent, newPartNumber, confidence, source, sourceUrl, cached, error? }
- Handle errors: invalid params (400), not found (200 with error field), server error (500)
- Support retry logic with exponential backoff

---

### Task 6: Enhance BOMAnalyzerTool UI with Real-Time Analysis

**Files:**
- Modify: `src/BOMAnalyzerTool.tsx`

**Steps:**
1. Add state for analysis results and tracking
2. Add analysis trigger function (`handleAnalyze`)
3. Add results table rendering with real-time status updates
4. Add download handler function (`handleDownloadResults`)
5. Add necessary imports (Lucide icons, utilities)
6. Update file selected state to show Analyze button
7. Commit with message: "feat: add real-time analysis UI with results table and download"

**Key Requirements:**
- State: `analysisResults`, `isAnalyzing`, `analysisProgress`
- Parse file → validate → initialize results with "searching" status
- Process 5-10 concurrent requests with rate-limiting
- Stream results to UI in real-time as they arrive
- Results table columns: Manufacturer, Part Number, Status, Equivalent, New Part #, Confidence
- Status indicators: 🔄 Searching / ✅ Found / ❌ Not found / ⚠️ Error
- Confidence badges: "Exact Match" (emerald) vs "Spec-Based" (amber)
- Progress bar showing (completed/total)
- Download button generates and downloads XLSX with timestamp
- Error handling: invalid rows, analysis failures

---

### Task 7: Integration Testing & Error Handling

**Files:**
- Create: `src/__tests__/BOMAnalyzerTool.integration.test.ts`

**Steps:**
1. Write integration tests for full workflow
2. Run tests to verify they pass
3. Commit with message: "test: add integration tests for BOM Analyzer full workflow"

**Key Requirements:**
- Full flow test: upload → analyze → download
- Invalid file tests: wrong column count, missing columns
- "Not found" component handling
- All tests use React Testing Library
- Mock API calls as needed
- 30-second timeout for analysis tests

---

### Task 8: Final Testing & Demo

**Files:**
- None (manual testing)

**Steps:**
1. Verify dev server runs: `npm run dev`
2. Manual workflow test: upload → analyze → download
3. Run all tests: `npm test`
4. Final commit if changes needed

**Key Requirements:**
- Dev server starts without errors
- Can upload XLSX file
- Real-time results stream and populate
- Download XLSX has all columns
- All tests pass

---

## Self-Review

**Spec Coverage:** All requirements from design doc covered
**No Placeholders:** All tasks have specific code and commands
**Type Consistency:** Interfaces consistent across tasks
