/**
 * Thousands grouping — "10000" → "10,000".
 *
 * Hand-rolled rather than `Intl`/`toLocaleString`, because Hermes does not
 * honour a locale argument consistently across the two platforms and an amount
 * someone is about to commit money to must not be grouped one way on Android
 * and another on iOS.
 */
export function grouped(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Naira formatting — integer amounts only, e.g. naira(220000) → "₦220,000". */
export function naira(n: number): string {
  return "₦" + grouped(n);
}
