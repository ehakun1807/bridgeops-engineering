// Application-level configuration constants.
//
// ADMIN_EMAIL gates access to private-beta surfaces (SaaS dashboard,
// Join SaaS CTA). Keep this in sync with the admin check in
// firestore.rules -> isAdmin().
export const ADMIN_EMAIL = 'ehakun1807@gmail.com';

/**
 * Client-side check. Note this is a UX gate only — the hard security
 * boundary is in firestore.rules. A determined user could bypass this
 * in the browser, but they'd still get permission-denied from Firestore.
 */
export const isAdminUser = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
};
