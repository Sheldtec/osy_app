/**
 * The bearer token, on its own.
 *
 * `lib/auth.tsx` imports `lib/api.ts` (for API_BASE and apiHeaders), so api.ts
 * cannot import auth.tsx back without a cycle. The token mirror therefore
 * lives here — a leaf module both can depend on.
 *
 * SecureStore is async but every authed request needs the token synchronously,
 * so AuthProvider primes this on launch and keeps it in step on sign-in and
 * sign-out. This module never touches storage itself.
 */
let memoryToken: string | null = null;

/** The current bearer token, or null when signed out. */
export function authToken(): string | null {
  return memoryToken;
}

/** Called by AuthProvider only. */
export function setAuthToken(token: string | null): void {
  memoryToken = token;
}
