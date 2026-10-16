import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { API_BASE, apiHeaders } from "./api";
import { authToken, setAuthToken } from "./auth-token";

/**
 * Who is signed in.
 *
 * Follows the same shape as `lib/cart.tsx` — a context over a provider mounted
 * in the root layout — and the same fetch-or-fall-back rule as `lib/api.ts`:
 * with no EXPO_PUBLIC_API_URL set, sign-in resolves LOCALLY so the screens can
 * be walked through before Laravel is pointed at. That local session is marked
 * `demo: true` and is never mistaken for a real one.
 *
 * The token goes in SecureStore (keychain / keystore), not AsyncStorage, which
 * is plain files. The profile is cached alongside it so the app can paint a
 * signed-in Profile screen on launch without waiting on a round trip.
 *
 * Auth endpoints are NOT in the kit's API-CONTRACT.md (it lists auth under
 * "later milestones"), so these paths follow the Laravel API the website
 * already talks to: POST /auth/login, POST /auth/register, GET /auth/me.
 */

const TOKEN_KEY = "osygentle.auth.token";
const USER_KEY = "osygentle.auth.user";

// The token mirror lives in ./auth-token so lib/api.ts can read it without
// importing this module back (api <- auth would be a cycle).
export { authToken };

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string | null;
  /** True when this session was created offline against the mock. */
  demo?: boolean;
}

/** Carries the backend's field-level validation messages to the form. */
export class AuthError extends Error {
  fields?: Record<string, string[]>;

  constructor(message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = "AuthError";
    this.fields = fields;
  }

  fieldError(name: string): string | undefined {
    return this.fields?.[name]?.[0];
  }
}

/**
 * The three screens of the signup wizard, in order.
 *
 * Mirrors `RegisterRequest::stepRules()` on the Laravel side — the server
 * names these exact steps, and `POST /auth/signup/step` rejects any other
 * value. If a step is added there, add it here.
 */
export type SignupStep = "email" | "phone" | "password";

export interface SignupInput {
  email: string;
  /** Required by the API. Signup used to omit it, so every attempt 422'd. */
  phone: string;
  password: string;
  passwordConfirmation: string;
  /** From a friend's invite link. Optional, and never invented. */
  referralCode?: string;
}

interface AuthValue {
  user: AuthUser | null;
  /** True until the stored session has been read — don't redirect before it. */
  loading: boolean;
  signedIn: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: SignupInput) => Promise<AuthUser>;
  /**
   * Validate one signup step against the server before moving to the next.
   *
   * Nothing is created until the final step, so this is what lets someone
   * learn on the first screen that their email is taken, instead of after
   * they have chosen a password. Mirrors the website's `checkSignupStep`.
   */
  checkSignupStep: (step: SignupStep, values: Record<string, string>) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const TIMEOUT_MS = 10_000;

/**
 * Registration needs its own, much longer budget.
 *
 * `Password::uncompromised()` makes the API call out to a breach database
 * while the request is open, and that was measured at 7-11 seconds against
 * this server. On the 10s budget the account was created and the APP gave up
 * waiting — so the customer saw "check your connection", tried again, and was
 * told their email was already taken. A dead end, from a signup that worked.
 */
const REGISTER_TIMEOUT_MS = 45_000;

/** Thrown when we stopped waiting, as opposed to never having got through. */
export class AuthTimeout extends AuthError {}

async function post<T>(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // These two are NOT the same thing, and on a write the difference is the
    // whole story: a request that never landed created nothing and is safe to
    // retry, while one we stopped waiting for may well have succeeded.
    if (controller.signal.aborted) {
      throw new AuthTimeout("The store took too long to answer.");
    }
    throw new AuthError("Could not reach the store. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    errors?: Record<string, string[]>;
  };

  if (!res.ok) {
    // The API answers a wrong email and a wrong password identically — that is
    // deliberate anti-enumeration. Show what it said; do not try to be more
    // specific here.
    throw new AuthError(data.message ?? fallbackMessage(res.status), data.errors);
  }

  return data as T;
}

/**
 * Copy for the statuses that arrive without a message of their own.
 *
 * This used to say "Sign-in failed" for everything, which was shown verbatim
 * on a failed REGISTRATION too.
 */
function fallbackMessage(status: number): string {
  if (status === 429) return "Too many attempts. Give it a minute and try again.";
  if (status >= 500) return "The store had a problem. Please try again in a moment.";
  return "That didn't go through. Please check your details and try again.";
}

/** A local session, for when there is no API to talk to yet. */
function demoUser(email: string, phone?: string): AuthUser {
  // Derived from the email's local part, so "ama.mensah@…" reads as a name
  // rather than as an address fragment.
  const derived = email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
    .trim();

  return {
    id: 0,
    // Signup no longer asks for a name — the API derives a provisional one
    // from the email exactly like this, so the demo session matches.
    name: derived || "Guest",
    email: email.trim(),
    phone: phone?.trim() || null,
    demo: true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [token, cached] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (!alive || !token || !cached) return;
        setAuthToken(token);
        setUser(JSON.parse(cached) as AuthUser);
      } catch {
        // Keychain unavailable, or a corrupt cache — treat as signed out
        // rather than failing to launch.
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (token: string, next: AuthUser) => {
    setAuthToken(token);
    setUser(next);
    try {
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, token),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(next)),
      ]);
    } catch {
      // The session still works for this launch; it just will not survive one.
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signedIn: Boolean(user),

      signIn: async (email, password) => {
        if (!API_BASE) {
          const next = demoUser(email);
          await persist("demo-token", next);
          return next;
        }
        const result = await post<{ token: string; user: AuthUser }>("/auth/login", {
          email: email.trim(),
          password,
        });
        await persist(result.token, result.user);
        return result.user;
      },

      /**
       * Create the account.
       *
       * The payload is `RegisterRequest`'s, exactly. This used to post
       * `{name, email, password}`: `name` is not a field the API accepts (it
       * derives a provisional one from the email) and `phone` is REQUIRED, so
       * every signup from the app failed validation before this.
       */
      signUp: async ({ email, phone, password, passwordConfirmation, referralCode }) => {
        if (!API_BASE) {
          const next = demoUser(email, phone);
          await persist("demo-token", next);
          return next;
        }
        const result = await post<{ token: string; user: AuthUser }>("/auth/register", {
          email: email.trim(),
          phone: phone.trim(),
          password,
          password_confirmation: passwordConfirmation,
          // Omitted rather than sent empty — the server treats an unknown code
          // as a validation error, and "no code" is not a wrong code.
          ...(referralCode?.trim() ? { referral_code: referralCode.trim().toUpperCase() } : {}),
        }, REGISTER_TIMEOUT_MS);
        await persist(result.token, result.user);
        return result.user;
      },

      checkSignupStep: async (step, values) => {
        // With no API there is nothing to check against, and a wizard that
        // refused to advance offline would be worse than one that lets you
        // through to the local demo session.
        if (!API_BASE) return;
        await post<{ ok: true }>("/auth/signup/step", { step, ...values });
      },

      signOut: async () => {
        setAuthToken(null);
        setUser(null);
        try {
          await Promise.all([
            SecureStore.deleteItemAsync(TOKEN_KEY),
            SecureStore.deleteItemAsync(USER_KEY),
          ]);
        } catch {
          /* already gone */
        }
      },
    }),
    [loading, persist, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
