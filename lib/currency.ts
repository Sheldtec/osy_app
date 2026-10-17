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

/**
 * A price BAND's label, built on the client so it follows the chosen currency.
 *
 * Some of the shop's option lists are money ranges whose `value` is also the
 * stored enum — the hair profile's budget bands, which the column holds and
 * which must be posted back byte-identical. The server therefore cannot
 * reword them, and sends the numeric edges (`min`/`max`, Naira, null for an
 * open end) beside the Naira wording instead. This turns those numbers back
 * into a sentence.
 *
 * `format` is the caller's formatter — `useApproxMoney()` in a component, or
 * `naira` to get the server's own wording back. Falls back to `label` when
 * there is nothing to format ("No fixed budget", or a band the server sent
 * without bounds), so it is safe to run over a whole option list.
 *
 * A converted two-ended band carries ONE leading "≈" rather than one per
 * edge: the marker belongs to the range, and "≈ $33 – ≈ $65" reads as a
 * mistake.
 */
export function moneyBandLabel(
  band: { label: string; min?: number | null; max?: number | null },
  format: (amountInNaira: number) => string,
): string {
  const min = typeof band.min === "number" ? band.min : null;
  const max = typeof band.max === "number" ? band.max : null;

  if (min === null && max === null) return band.label;
  if (min === null) return `Under ${format(max as number)}`;
  if (max === null) return `Above ${format(min)}`;

  const lo = format(min);
  const hi = format(max);

  return `${lo} – ${hi.startsWith("≈ ") ? hi.slice(2) : hi}`;
}

/**
 * A coupon's two labels, built on the client so they follow the chosen currency.
 *
 * The API also sends `discount_label` and `condition_label` ready-made, but
 * those bake a Naira sign into the string — which is exactly why the shop
 * still read "₦5,000 OFF" after someone switched to dollars. The server now
 * sends `value` alongside `type` and `min_spend`, which is everything the
 * labels are made of, so the client can format them itself.
 *
 * `format` is the caller's formatter — `useApproxMoney()` in a component. Pass
 * `naira` instead and you get the server's exact wording back.
 *
 * Percent and free-shipping labels carry no money at all; they are built here
 * anyway so one function owns the whole vocabulary and no screen has to decide
 * which of the two sources to trust.
 */
export function couponLabels(
  coupon: {
    type: "percent" | "fixed" | "free_shipping";
    value?: number | null;
    min_spend?: number | null;
  },
  format: (amountInNaira: number) => string,
): { discount: string; condition: string } {
  const value = coupon.value ?? 0;

  const discount =
    coupon.type === "percent"
      ? `${value}% OFF`
      : coupon.type === "fixed"
        ? `${format(value)} OFF`
        : coupon.type === "free_shipping"
          ? "FREE SHIPPING"
          : "DISCOUNT";

  const min = coupon.min_spend ?? 0;
  const condition = min > 0 ? `Over ${format(min)}` : "For any order";

  return { discount, condition };
}

/**
 * Attach a +/- sign to an already-formatted amount.
 *
 * `formatMoney` puts "≈ " in front of a CONVERTED figure, so writing the sign
 * as a separate piece of text gives "+≈ $3.76" - the approximation marker
 * wedged between the sign and its number. The marker qualifies the whole
 * amount, so it stays in front and the sign moves inside it:
 *
 *   "+₦35,000"  (Naira, unchanged)      "≈ +$3.76"  (converted)
 */
export function signedMoney(formatted: string, sign: "+" | "−"): string {
  return formatted.startsWith("≈ ")
    ? `≈ ${sign}${formatted.slice(2)}`
    : `${sign}${formatted}`;
}
