import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { request } from "./http";
import { formatMoney, type CurrencyCode, type RatePayload } from "./currency";

/**
 * Which currency prices are SHOWN in.
 *
 * The chosen code lives on the device (it is a reading preference, not account
 * data, and should survive signing out). Rates are fetched at most once every
 * six hours and cached, matching the website — the endpoint is public, cached
 * for five minutes upstream and shared with five catalogue routes on one
 * 60/min bucket, so polling it would cost other screens their budget.
 *
 * Deliberately NOT wired into `naira()`. That function stays the ₦-only
 * primitive so conversion is something a screen opts into, figure by figure,
 * via `useApproxMoney()`. The opposite arrangement — convert by default,
 * remember to opt out — is how a converted number ends up on a Pay button.
 */

const CODE_KEY = "osygentle.currency.v1";
const RATES_KEY = "osygentle.currency.rates.v1";
/** Matches the website's own cache window. */
const RATES_TTL_MS = 6 * 60 * 60 * 1000;

interface CurrencyValue {
  code: CurrencyCode;
  setCode: (code: CurrencyCode) => void;
  rates: RatePayload | null;
  /** True until the stored choice has been read — avoids a flash of ₦ then $. */
  ready: boolean;
  /** "live" or "fallback"; the latter means the figures could be well out. */
  source: string | null;
}

const CurrencyContext = createContext<CurrencyValue | null>(null);

interface Cached {
  at: number;
  payload: RatePayload;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<CurrencyCode>("NGN");
  const [rates, setRates] = useState<RatePayload | null>(null);
  const [ready, setReady] = useState(false);

  // ---- the chosen code -----------------------------------------------------
  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(CODE_KEY);
        if (alive && saved) setCodeState(saved as CurrencyCode);
      } catch {
        // Unreadable storage just means Naira, which is always correct.
      } finally {
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // ---- the rates -----------------------------------------------------------
  useEffect(() => {
    let alive = true;

    void (async () => {
      // Serve the cache first so prices never wait on the network.
      try {
        const raw = await AsyncStorage.getItem(RATES_KEY);
        if (raw && alive) {
          const cached = JSON.parse(raw) as Cached;
          if (cached?.payload) setRates(cached.payload);
          // Still fresh — don't spend a request.
          if (cached && Date.now() - cached.at < RATES_TTL_MS) return;
        }
      } catch {
        /* fall through to a fetch */
      }

      try {
        // No Authorization header on purpose: an authenticated request makes
        // the server send `private, no-store` and forfeits the public cache
        // and its 304s.
        const payload = await request<RatePayload>("/exchange-rates");
        if (!alive) return;

        setRates(payload);
        await AsyncStorage.setItem(
          RATES_KEY,
          JSON.stringify({ at: Date.now(), payload } satisfies Cached),
        ).catch(() => {});
      } catch {
        // Keep whatever was cached; `formatMoney` falls back to a static
        // table and finally to Naira, so nothing is ever quoted at 1:1.
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const setCode = useCallback((next: CurrencyCode) => {
    setCodeState(next);
    void AsyncStorage.setItem(CODE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<CurrencyValue>(
    () => ({ code, setCode, rates, ready, source: rates?.source ?? null }),
    [code, setCode, rates, ready],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used inside <CurrencyProvider>");

  return ctx;
}

/**
 * Format a NAIRA amount for DISPLAY, in whatever currency is chosen.
 *
 * Use this for money the shopper is READING — a catalogue price, a past
 * order's total, a wallet balance.
 *
 * Do NOT use it for money that is being TRANSACTED or compared: a checkout
 * total, a Pay button, an amount typed into a form that is posted to the API,
 * or a server-evaluated threshold (the withdrawal minimum, a coupon's minimum
 * spend, the VIP fee, the shop's price-band filters). Those stay `naira()`,
 * because the server computes the real charge itself with its own rounding and
 * a converted figure there would be a number the gateway never shows.
 *
 * Converted output always carries a leading "≈".
 */
export function useApproxMoney(): (amountInNaira: number) => string {
  const { code, rates } = useCurrency();

  return useCallback(
    (amountInNaira: number) => formatMoney(amountInNaira, code, rates?.rates),
    [code, rates],
  );
}
