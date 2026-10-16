/**
 * Display currency — presentation only.
 *
 * Everything in this shop is priced AND CHARGED in Naira. These helpers exist
 * so a shopper abroad can read a familiar figure while browsing; they must
 * never produce a number that is sent to the API or promised on a button.
 *
 * RATE DIRECTION, which is the easiest thing to get catastrophically wrong:
 * the server publishes FOREIGN UNITS PER 1 NAIRA (USD ≈ 0.00075), so you
 * MULTIPLY. Dividing would quote a ₦220,000 wig at roughly $293 million.
 */

export type CurrencyCode = "NGN" | "USD" | "GBP" | "EUR" | "GHS" | "ZAR";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
}

/** The five the server offers, plus the base. Order is the picker's order. */
export const CURRENCIES: CurrencyMeta[] = [
  { code: "NGN", symbol: "₦", name: "Nigerian naira", decimals: 0 },
  { code: "USD", symbol: "$", name: "US dollar", decimals: 2 },
  { code: "GBP", symbol: "£", name: "British pound", decimals: 2 },
  { code: "EUR", symbol: "€", name: "Euro", decimals: 2 },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian cedi", decimals: 2 },
  { code: "ZAR", symbol: "R", name: "South African rand", decimals: 2 },
];

export function metaFor(code: CurrencyCode): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/**
 * A static table for when a rate is simply absent.
 *
 * The server omits a currency from a SUCCESSFUL "live" response if upstream
 * did not return it, so `rates[code]` can be undefined even when nothing
 * failed. Falling back to 1.0 there would quote a ₦220,000 wig as $220,000 —
 * so an approximate real rate is the only safe default, and the UI drops to
 * Naira if even this is missing.
 */
export const FALLBACK_RATES: Record<CurrencyCode, number> = {
  NGN: 1,
  USD: 0.00065,
  GBP: 0.00051,
  EUR: 0.0006,
  GHS: 0.0079,
  ZAR: 0.0119,
};

export interface RatePayload {
  base: string;
  rates: Partial<Record<CurrencyCode, number>>;
  /** "live" = fetched upstream within 12h · "fallback" = the server's own static table. */
  source: string;
  fetched_at: string | null;
  /** Rates the owner pinned by hand. Present in the response; unused here. */
  manual?: unknown[];
}

/** Thousands separators, hand-rolled to match `naira()` rather than rely on Intl. */
function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a NAIRA amount in the chosen display currency.
 *
 * Returns a plain Naira string for NGN. For anything else the result is
 * PREFIXED WITH "≈" — the approximation marker is part of the formatter, not
 * something a call site has to remember, because a converted figure presented
 * as exact is the failure mode that matters here.
 */
export function formatMoney(
  amountInNaira: number,
  code: CurrencyCode,
  rates?: Partial<Record<CurrencyCode, number>>,
): string {
  const meta = metaFor(code);

  if (code === "NGN") {
    return meta.symbol + group(String(Math.round(amountInNaira)));
  }

  const rate = rates?.[code] ?? FALLBACK_RATES[code];
  // No usable rate at all: say it in Naira rather than invent a conversion.
  if (!rate || rate <= 0) {
    return CURRENCIES[0].symbol + group(String(Math.round(amountInNaira)));
  }

  const converted = amountInNaira * rate;
  const fixed = converted.toFixed(meta.decimals);
  const [whole, fraction] = fixed.split(".");

  return `≈ ${meta.symbol}${group(whole)}${fraction ? "." + fraction : ""}`;
}

/**
 * The disclosure, in one place.
 *
 * Mirrors the website's `locale.chargedNgn` string and is shown
 * UNCONDITIONALLY on the picker — not only once a foreign currency is chosen.
 */
export const CHARGED_IN_NAIRA =
  "Prices are converted for display. You’re charged in Naira (₦).";
