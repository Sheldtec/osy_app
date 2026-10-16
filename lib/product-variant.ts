/**
 * The variant a product opens on, and what it therefore costs.
 *
 * Ported from the website's lib/product-variant.ts, deliberately unchanged in
 * its arithmetic so the two storefronts cannot quote different figures for the
 * same piece.
 *
 * The app needed it because the bag priced every line at the product's BASE
 * price while the server charges `Product::priceFor($length)` — the per-length
 * override, discounted. On a product whose 22" rung is priced above its base,
 * the bag, both checkout steps and the pay bar all showed the base price and
 * the order was charged the override. For a wallet payment nothing ever showed
 * the real figure: the shopper first met it on the confirm screen.
 *
 * There are two prices for every variant and they must not be confused:
 *   LIST — what the admin authored, the number shown struck through.
 *   NET  — what the customer is charged, after the product's discount.
 */

/**
 * Everything these helpers need, as a structural type rather than `Product`.
 *
 * Structural rather than `Product` so a cart line, a mock product and a
 * search result can all be priced by the same code — re-implementing it per
 * surface is how the two prices drifted apart in the first place.
 */
export interface Priceable {
  price: number;
  discount_percent?: number | null;
  sale_price?: number | null;
  lengths?: string[];
  length_prices?: Record<string, number>;
  sale_length_prices?: Record<string, number>;
}

/** Leading number of a length token: `18"` → 18. */
function inches(length: string): number {
  const n = parseInt(length, 10);

  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Lengths in ascending numeric order. Stored order is whatever the admin
 * happened to enter — one product holds `["10\"", "11\"", "6\""]` — so relying
 * on it makes both the chip order and any positional default arbitrary.
 */
export function sortedLengths(lengths: string[] | undefined): string[] {
  return [...(lengths ?? [])].sort((a, b) => inches(a) - inches(b) || a.localeCompare(b));
}

/** This product's discount, clamped to the same 0-90 bound the server uses. */
export function discountPct(product: Priceable): number {
  return Math.min(90, Math.max(0, Math.round(Number(product.discount_percent ?? 0))));
}

/**
 * Floor, never round — it mirrors `intdiv()` in Product::discountedAmount() and
 * `FLOOR()` in Product::sellingPriceSql(). Rounding here instead would put the
 * cart a Naira above the charge on roughly half of all prices.
 *
 * Only used as a FALLBACK: live products carry the server's own figures.
 */
function applyDiscount(amount: number, pct: number): number {
  return Math.floor((amount * (100 - pct)) / 100);
}

/**
 * LIST price for one length: its own override if set, otherwise the base.
 *
 * Load-bearing for defaultLength() below, which compares against
 * `product.price` — also a list price. Make this return the net price and
 * every product silently opens on its shortest length instead of the one the
 * admin priced as the headline, which is the precise bug this file was
 * written to fix.
 */
export function priceForLength(product: Priceable, length: string | undefined): number {
  if (!length) return product.price;

  return product.length_prices?.[length] ?? product.price;
}

/** NET price for one length — what the customer actually pays. */
export function netPriceForLength(product: Priceable, length: string | undefined): number {
  if (length) {
    // The server already did this arithmetic; prefer its answer.
    const serverOverride = product.sale_length_prices?.[length];
    if (serverOverride != null) return serverOverride;

    const listOverride = product.length_prices?.[length];
    if (listOverride != null) return applyDiscount(listOverride, discountPct(product));
  }

  return product.sale_price ?? applyDiscount(product.price, discountPct(product));
}

/**
 * The length a product should open on.
 *
 * Prefers the length priced at the product's base `price` — that is the figure
 * the admin set as the headline, so opening there honours their intent. When no
 * length matches it (the per-length table and the base price disagree), fall
 * back to the SHORTEST, which is both the cheapest and the conventional "from"
 * price for a listing.
 */
export function defaultLength(product: Priceable): string | undefined {
  const lengths = sortedLengths(product.lengths);
  if (lengths.length === 0) return undefined;

  const atBasePrice = lengths.find(
    (l) => priceForLength(product, l) === product.price,
  );

  return atBasePrice ?? lengths[0];
}

/**
 * The price to advertise for a product — always the price of the variant its
 * page will open on, so the grid never quotes a figure the PDP contradicts.
 * This is the NET price: it is what the shopper pays.
 */
export function displayPrice(product: Priceable): number {
  return netPriceForLength(product, defaultLength(product));
}

/** The same variant's LIST price — the number to strike through. */
export function displayListPrice(product: Priceable): number {
  return priceForLength(product, defaultLength(product));
}
