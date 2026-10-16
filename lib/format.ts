/** Naira formatting — integer amounts only, e.g. naira(220000) → "₦220,000". */
export function naira(n: number): string {
  return "\u20A6" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
