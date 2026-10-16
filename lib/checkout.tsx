import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "./auth";

/**
 * What the shopper has filled in, carried between the checkout steps.
 *
 * It is persisted because a phone is backgrounded constantly — a shopper who
 * checks their banking app mid-checkout should not come back to an empty form.
 * The old single-screen checkout started blank on every visit and lost
 * everything to a backgrounding, which on a 7-field address is the difference
 * between finishing and giving up.
 *
 * Keyed by user id, never shared. Two accounts on one device must not see each
 * other's address, and a signed-out device must not keep one at all.
 */

export type DeliveryMethod = "standard" | "express" | "pickup";
export type PackagingTier = "standard" | "premium" | "luxe";

export interface CheckoutDraft {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** ISO-2. Members ship within Nigeria, as on the website. */
  country: string;
  method: DeliveryMethod;
  packaging: PackagingTier;
  note: string;
  coupon: string;
}

const EMPTY: CheckoutDraft = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  country: "NG",
  method: "standard",
  packaging: "standard",
  note: "",
  coupon: "",
};

/** The seven fields the API needs before an order can be priced or shipped. */
const REQUIRED: (keyof CheckoutDraft)[] = [
  "first_name",
  "last_name",
  "phone",
  "address",
  "city",
  "state",
  "zip",
];

/**
 * An order that has been created and is waiting on money.
 *
 * Written the moment POST /orders returns, BEFORE the browser sheet opens, so
 * that a shopper whose app is killed while the hosted page is in front still
 * has a reference to verify on the next launch. Without this the order exists,
 * the stock is already decremented, and the app has no way to find out whether
 * it was paid.
 */
export interface PendingPayment {
  orderRef: string;
  txRef: string;
  method: string;
  total: number;
  /** ms epoch, so a stale one can be aged out rather than nagging forever. */
  at: number;
  /**
   * Bank transfer and crypto details, kept because they arrive exactly ONCE.
   * POST /orders returns them in the create response and no customer endpoint
   * will ever give them back — `payment_ref` is admin-only on the order
   * payload. A shopper who closes the app before noting the account number
   * would otherwise have an order they cannot pay.
   */
  instructions?: unknown;
}

const DRAFT_KEY = (userId: number | string) => `osygentle.checkout.v1.${userId}`;
const PENDING_KEY = (userId: number | string) => `osygentle.checkout.pending.v1.${userId}`;

/** A pending payment older than this is not worth chasing on launch. */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

interface CheckoutValue {
  draft: CheckoutDraft;
  /** False until the stored draft has been read — don't write over it before. */
  ready: boolean;
  set: (patch: Partial<CheckoutDraft>) => void;
  reset: () => void;
  /** True once every field POST /orders requires is filled in. */
  addressComplete: boolean;
  /** Which required fields are still empty, for per-field messages. */
  missing: (keyof CheckoutDraft)[];
  pending: PendingPayment | null;
  setPending: (p: PendingPayment | null) => void;
}

const CheckoutContext = createContext<CheckoutValue | null>(null);

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = user?.id ?? null;

  const [draft, setDraft] = useState<CheckoutDraft>(EMPTY);
  const [pending, setPendingState] = useState<PendingPayment | null>(null);
  const [ready, setReady] = useState(false);

  // Guards the first render from writing an empty draft over a stored one,
  // the same way the cart context does.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydrated.current = false;
    setReady(false);

    (async () => {
      // Signed out: hold nothing. An address is personal data and there is no
      // account to attach it to.
      if (owner === null) {
        if (!cancelled) {
          setDraft(EMPTY);
          setPendingState(null);
          hydrated.current = true;
          setReady(true);
        }
        return;
      }

      const [rawDraft, rawPending] = await Promise.all([
        AsyncStorage.getItem(DRAFT_KEY(owner)).catch(() => null),
        AsyncStorage.getItem(PENDING_KEY(owner)).catch(() => null),
      ]);
      if (cancelled) return;

      setDraft(rawDraft ? { ...EMPTY, ...(safeParse(rawDraft) ?? {}) } : EMPTY);

      const p = rawPending ? (safeParse(rawPending) as PendingPayment | null) : null;
      setPendingState(p && Date.now() - p.at < PENDING_TTL_MS ? p : null);

      hydrated.current = true;
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [owner]);

  useEffect(() => {
    if (!hydrated.current || owner === null) return;
    void AsyncStorage.setItem(DRAFT_KEY(owner), JSON.stringify(draft)).catch(() => {});
  }, [draft, owner]);

  const set = useCallback((patch: Partial<CheckoutDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const reset = useCallback(() => {
    // The address survives — it is the part worth keeping for next time. Only
    // the per-order choices go.
    setDraft((d) => ({ ...d, method: "standard", packaging: "standard", note: "", coupon: "" }));
  }, []);

  const setPending = useCallback(
    (p: PendingPayment | null) => {
      setPendingState(p);
      if (owner === null) return;
      void (p
        ? AsyncStorage.setItem(PENDING_KEY(owner), JSON.stringify(p))
        : AsyncStorage.removeItem(PENDING_KEY(owner))
      ).catch(() => {});
    },
    [owner],
  );

  const missing = useMemo(
    () => REQUIRED.filter((k) => String(draft[k] ?? "").trim() === ""),
    [draft],
  );

  const value = useMemo<CheckoutValue>(
    () => ({
      draft,
      ready,
      set,
      reset,
      addressComplete: missing.length === 0,
      missing,
      pending,
      setPending,
    }),
    [draft, ready, set, reset, missing, pending, setPending],
  );

  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}

export function useCheckout(): CheckoutValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx) throw new Error("useCheckout must be used inside CheckoutProvider");
  return ctx;
}

function safeParse(raw: string): Partial<CheckoutDraft> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<CheckoutDraft>) : null;
  } catch {
    return null;
  }
}

/** Human labels for the required fields, for the "still needed" message. */
export const FIELD_LABEL: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  phone: "Phone",
  address: "Street address",
  city: "City",
  state: "State",
  zip: "Postcode",
};
