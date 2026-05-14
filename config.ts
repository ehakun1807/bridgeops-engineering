// Application-level configuration constants.
//
// ALLOWED_EMAILS gates access to private-beta surfaces (SaaS dashboard,
// Join SaaS CTA, all /api/* AI handlers). KEEP THIS IN SYNC with the
// matching `email in [...]` list inside firestore.rules -> isAdmin().
// Adding a beta tester = one entry here + one entry in firestore.rules.
//
// Removing a tester at end of beta = delete their entry from both files,
// re-deploy rules (paste into Firebase Console per the multi-DB deploy
// gotcha), and delete the Firebase Auth user from the Console.
export const ALLOWED_EMAILS: readonly string[] = [
  'ehakun1807@gmail.com',
  'beta1@bridgeops.local',
  'beta2@bridgeops.local',
  // Beta testers — add 2 entries below, then mirror them in
  // firestore.rules. Remove at end of beta.
  // 'beta1@example.com',
  // 'beta2@example.com',
];

// Pre-computed lowercase set for O(1) lookup. The auth check fires on
// every /api/* request so it's worth doing once.
const _allowedLower = new Set(ALLOWED_EMAILS.map((e) => e.toLowerCase()));

/**
 * The canonical allowlist check. Used by both client (AuthModal, App
 * dashboard gate) and server (every /api/* handler). Case-insensitive.
 */
export const isAllowedEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return _allowedLower.has(email.toLowerCase());
};

/**
 * Back-compat alias. Existing client code (AuthModal, App.tsx) imports
 * isAdminUser; keep it working without churning those call sites.
 *
 * Note this is a UX gate only — the hard security boundary is in
 * firestore.rules + the /api/* handlers. A determined user could bypass
 * this in the browser, but they'd still get permission-denied server-side.
 */
export const isAdminUser = isAllowedEmail;

/**
 * Back-compat alias. Some older comments / docs reference ADMIN_EMAIL as
 * a single string. Points at the primary admin (first entry).
 */
export const ADMIN_EMAIL = ALLOWED_EMAILS[0];
