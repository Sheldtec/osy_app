import {
  getCollections,
  getFacets,
  getStorefrontHome,
  type ProductQuery,
} from "./api";
import type { Facet, ProductFacets } from "./types";

/**
 * The Home screen's shelf manifest.
 *
 * Home used to be one query for four products. It is now a list of
 * COLLECTIONS, each with its own query, built at runtime from what the shop
 * actually contains — the admin's curated collections and the live facet
 * counts — rather than from a hardcoded list that drifts the moment the
 * catalogue changes.
 *
 * The owner's rule is "each collection not less than 20 products". That is
 * enforced HERE, against real counts, before any UI exists: a generated shelf
 * is admitted only if its facet count clears MIN_SHELF, so a rail can never be
 * built that cannot fill itself. Padding a thin shelf with unrelated products
 * to reach twenty would satisfy the letter of the rule and lie to the
 * customer, so it is not done.
 *
 * The exception is shelves the OWNER chose — the admin's configured home
 * shelves and curated collections. Those are pinned whatever their size,
 * because omitting a collection the owner deliberately created is worse than
 * showing a small one. They carry their true count in the header, so a
 * three-product Hot Deals reads as deliberate merchandising rather than a rail
 * that failed to load.
 */

/** The owner's floor for a GENERATED shelf. Curated shelves are exempt. */
export const MIN_SHELF = 20;

/** Products fetched per shelf page. A literal, never computed — see api.ts. */
export const SHELF_PAGE = 20;

export interface Shelf {
  /** Stable identity — also the React key and the per-shelf state key. */
  id: string;
  title: string;
  subtitle: string | null;
  /** The query that fills it, minus paging. */
  query: ProductQuery;
  /**
   * How many products this shelf can actually return, known before fetching
   * from facet counts or `collections[].product_count`. `null` when only the
   * server can say (the catalogue-wide sorts), in which case the shelf shows
   * `meta.total` once page 1 lands.
   */
  total: number | null;
  /** Chosen by the owner, so exempt from MIN_SHELF. */
  pinned: boolean;
}

/**
 * Axes that genuinely PARTITION the catalogue.
 *
 * This ordering is deliberate. A shelf built on a sort (`featured`, `newest`,
 * `rating`) is not a different collection — it is the same catalogue in a
 * different order, and two such shelves show largely the same products under
 * different headings. Only these facet axes cut the catalogue into sets that
 * are actually distinct, which is what "a different collection" has to mean.
 *
 * `lengths` is deliberately absent: a product lists several lengths, so those
 * counts sum to far more than the catalogue and the shelves would overlap
 * heavily. Same reasoning, opposite direction.
 */
const AXES: {
  facet: keyof Omit<ProductFacets, "price">;
  param: keyof ProductQuery;
  title: (value: string) => string;
}[] = [
  { facet: "categories", param: "category", title: (v) => capitalise(v) },
  { facet: "wig_types", param: "type", title: (v) => plural(v) },
  { facet: "sources", param: "source", title: (v) => `${v} hair` },
  { facet: "thicknesses", param: "thickness", title: (v) => v },
  { facet: "laces", param: "lace", title: (v) => v },
  { facet: "caps", param: "cap", title: (v) => v },
  { facet: "textures", param: "texture", title: (v) => v },
  { facet: "grades", param: "grade", title: (v) => `Grade ${v}` },
];

function capitalise(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function plural(v: string): string {
  const t = capitalise(v);
  return t.endsWith("s") ? t : `${t}s`;
}

/** Multi-select facet params take a string[]; `category` takes a scalar. */
function queryFor(param: keyof ProductQuery, value: string): ProductQuery {
  return param === "category"
    ? { category: value }
    : ({ [param]: [value] } as ProductQuery);
}

export interface HomePlan {
  shelves: Shelf[];
  /**
   * Categories that actually hold products, for the circular rail.
   *
   * Read from the live facets rather than the hardcoded list, which offers
   * Closures (0 products) and Curls (matches no category at all) — two of the
   * five circles on Home lead nowhere.
   */
  categories: { key: string; label: string; count: number }[];
}

/**
 * Build the manifest.
 *
 * Every call here is forgiving — a failure costs shelves, not the screen. If
 * everything fails the caller still has the catalogue-wide fallback shelf, and
 * the products fetch behind it surfaces the real error.
 */
export async function buildHome(): Promise<HomePlan> {
  const [home, collections, facets] = await Promise.all([
    getStorefrontHome().catch(() => null),
    getCollections().catch(() => null),
    getFacets().catch(() => null),
  ]);

  const shelves: Shelf[] = [];

  // --- 1. The admin's configured home shelves, in their configured order ---
  // These ride catalogue-wide sorts, so their `total` is the whole catalogue
  // and only the server can report it.
  const featured = home?.featured;
  shelves.push({
    id: "home:featured",
    title: featured?.title?.trim() || "Featured this season",
    subtitle: null,
    query: { sort: featured?.source?.trim() || "featured" },
    total: null,
    pinned: true,
  });

  const second = home?.second;
  if (second?.enabled !== false && (second?.title || second?.source)) {
    shelves.push({
      id: "home:second",
      title: second.title?.trim() || "New arrivals",
      subtitle: null,
      query: { sort: second.source?.trim() || "newest" },
      total: null,
      pinned: true,
    });
  }

  // --- 2. The owner's curated collections -------------------------------
  // Pinned at their real size. `product_count` is authoritative and already
  // counts only active products, so an empty collection is dropped before it
  // can render as a headed, blank band.
  for (const c of (collections?.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
    if (c.product_count <= 0) continue;
    shelves.push({
      id: `collection:${c.key}`,
      title: c.title,
      subtitle: c.subtitle,
      query: { collection: c.key },
      total: c.product_count,
      pinned: true,
    });
  }

  // --- 3. Generated shelves, largest first within each axis ---------------
  if (facets) {
    for (const axis of AXES) {
      const values = (facets[axis.facet] as Facet[] | undefined) ?? [];
      const eligible = values
        .filter((f) => f.value && f.count >= MIN_SHELF)
        .sort((a, b) => b.count - a.count);

      for (const f of eligible) {
        shelves.push({
          id: `${axis.param}:${f.value}`,
          title: axis.title(f.value),
          subtitle: null,
          query: queryFor(axis.param, f.value),
          total: f.count,
          pinned: false,
        });
      }
    }
  }

  const categories = ((facets?.categories as Facet[] | undefined) ?? [])
    .filter((f) => f.value && f.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((f) => ({ key: f.value, label: capitalise(f.value), count: f.count }));

  return { shelves: dedupe(shelves), categories };
}

/**
 * Drop shelves that would read as duplicates.
 *
 * Two rules, both about what the customer sees rather than what the data says:
 * a repeated QUERY would show the identical products twice, and a repeated
 * TITLE is indistinguishable from a bug even when the two queries differ —
 * the admin's "New Arrivals" collection and a "New arrivals" sort shelf being
 * exactly that case. Earlier wins, which keeps the owner's own shelves.
 */
function dedupe(shelves: Shelf[]): Shelf[] {
  const seenQuery = new Set<string>();
  const seenTitle = new Set<string>();
  const out: Shelf[] = [];

  for (const s of shelves) {
    const q = JSON.stringify(
      Object.entries(s.query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
    );
    const t = s.title.trim().toLowerCase();
    if (seenQuery.has(q) || seenTitle.has(t)) continue;
    seenQuery.add(q);
    seenTitle.add(t);
    out.push(s);
  }

  return out;
}
