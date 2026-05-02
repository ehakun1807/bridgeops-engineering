# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server on **port 3000** (not the default 5173). Configured in `vite.config.ts`.
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the built `dist/` locally (port 4173).
- `npm run lint` — `tsc --noEmit` (TypeScript type-check; no ESLint).
- `npm test` — Jest. Test files live in `__tests__/` and match `**/__tests__/**/*.test.ts`.
- Run a single test: `npx jest __tests__/<file>.test.ts` or `npx jest -t "<test name>"`.
- `npm run deploy:rules` / `deploy:indexes` / `deploy:firestore` — Firebase deploys.

`GEMINI_API_KEY` must be set in `.env.local` (Vite exposes it as `process.env.API_KEY` and `process.env.GEMINI_API_KEY` via `define` in `vite.config.ts`).

## Architecture

**Flat layout — no `src/` directory.** Every component, client, and helper sits at the project root. The path alias `@/*` resolves to the project root (both Vite and tsconfig). Imports must include explicit `.tsx` / `.ts` extensions (`allowImportingTsExtensions: true`).

**Entry & routing.** `index.tsx` mounts `App.tsx`. `App.tsx` implements hash-based routing via `VIEW_TO_PATH` / `PATH_TO_VIEW` maps and the `View` union type in `types.ts`. Heavy views (`Dashboard`, `RampScoreTool`) are `React.lazy`-loaded to keep the marketing-home bundle lean. Adding a new view means: extend the `View` union in `types.ts`, register it in both maps + `VIEW_TITLES` in `App.tsx`, and add the lazy import.

**Two surfaces in one app.**
1. *Marketing site* (Hero, Services, Pricing, MethodologyLayers, ContactForm, etc.) — public.
2. *Admin / SaaS dashboard* (Dashboard → ProjectDeepDive → AdvancedToolsModal → BOMAnalyzerTool, plus RampScoreTool, ScoreHistoryPanel, GateDeliverablesModal, etc.) — gated by Firebase auth.

**Auth & admin gating.** `firebase.ts` initializes the Firebase app from `firebase-applet-config.json` and exports `auth` + `db` (Firestore). `config.ts` defines `ADMIN_EMAIL` and `isAdminUser()` — this is a UX gate only; the real security boundary is `firestore.rules` (`isAdmin()`). Keep `ADMIN_EMAIL` in `config.ts` and the rules file in sync.

**AI integrations.** `aiClient.ts` and `coachClient.ts` are the front-end clients. The `api/` folder (`ai-analyze.ts`, `ai-coach.ts`, `find-equivalent.ts`) holds serverless handlers that wrap Gemini.

**Domain logic / generators.** `rampGroups.ts`, `productSegments.ts`, `productStandards.ts`, `templates.ts`, `indicators.ts`, `pptxGenerator.ts` (PPTX export via `pptxgenjs`), and `notify.ts` are pure-ish modules consumed by the dashboard tools.

**Testing.** `jest.config.*` uses `ts-jest` + `jsdom`. Note `testMatch` is `*.test.ts` only — `.tsx` test files will be ignored. Setup file: `jest.setup.js`.

## Repository gotchas

- **`.claude/worktrees/<branch>/` contains full duplicates** of source files (it's a git worktree for a feature branch). **Never edit files there** — Vite doesn't import from it, but it shows up in `Grep` results and is misleading. Always edit at the project root.
- **`dist/` may exist locally** even though it's `.gitignore`d. If you see a stale build, the dev server on port 3000 is the source of truth — anything else (preview, deployed site) needs `npm run build` first.
- **Hash routing only.** Don't introduce `react-router-dom` or path-based routing without updating the routing logic in `App.tsx`.
- **No ESLint.** "Lint" means `tsc --noEmit`. Type errors are the lint signal.
- **Vite stale-cache symptom**: if a code edit isn't visible in the browser even after reload, kill the dev server and run `rm -rf node_modules/.vite dist` before restarting `npm run dev`. Vite's transform cache occasionally serves old compiled output.
- **Port drift**: `npm run dev` will silently fall back to 3001/3002/etc. if 3000 is occupied by a previous orphaned process. Check the terminal's `Local: http://localhost:XXXX` line and kill stragglers with `lsof -ti:3000 | xargs kill -9`.

## Session log

### 2026-05-01
- **UI fix:** changed `Advanced Tool` → `Advanced Tools` button label in `ProjectDeepDive.tsx` (line 1396, footer toolbar next to Cancel Project / Mark Completed).
- **Debugged stale-cache issue** while verifying that fix — root cause was Vite's `node_modules/.vite` cache plus an orphan dev-server holding port 3000. Documented as gotchas above.
- **Auth/security audit** of the AI Tool. Confirmed 4 independent layers, all hardcoded to `ehakun1807@gmail.com`:
  1. `AuthModal.tsx` — Google sign-in deletes non-admin Firebase Auth account on the spot; email/password path is login-only (no signup wired).
  2. `App.tsx` dashboard route — renders "Private Beta" lockout for any non-admin even if signed in.
  3. `firestore.rules` — `isAdmin()` checks role==admin OR email==ADMIN_EMAIL with `email_verified==true`. Per-collection owner/admin gating on projects/scores/tasks/users; `leads` is public-create / admin-read.
  4. `api/ai-analyze.ts`, `api/ai-coach.ts`, `api/find-equivalent.ts` — verify Firebase ID token signature against Google's RS256 public keys, reject anything not matching `ADMIN_EMAIL` + `email_verified`.
- **Open follow-ups:** (a) run `npm run deploy:rules` so production enforces current `firestore.rules`; (b) review Firebase Console → Authentication → Users for any unexpected accounts; (c) optionally disable Email/Password provider in Firebase Console since only Google is used in practice.
