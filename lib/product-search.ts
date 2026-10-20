import type { ProductQuery } from "./api";
import { request } from "./http";
import type { Category } from "./types";

/**
 * Searching the catalogue in words rather than filters.
 *
 * Two endpoints, one vocabulary. `/products/interpret` reads a whole sentence
 * ("long curly wig under 200k") into the structured facet filters the shop
 * already understands, and `/products/suggest` answers the half-typed word
 * with the products it would match. Both are the SAME parser the website
 * uses — there is one vocabulary for this shop, not a web one and an app one,
 * which is also why nothing here tries to guess at words locally.
 *
 * RELAXATION lives on the server, and that is the important part to get right
 * at this end. The reply carries both what the shopper appeared to ask for
 * (`chips`) and what the server ACTUALLY filtered on after dropping whatever
 * would have returned nothing (`applied`). Only `applied` is ever used to
 * build a query; `chips`, `relaxed` and `ignored` exist to tell the shopper
 * how their sentence was read. Filtering on the chips instead is how a shop
 * ends up showing an empty grid under a confident summary of a search it did
 * not run.
 *
 * And when the parser is unreachable, a sentence degrades to a plain keyword
 * search rather than to nothing — the same bargain the website strikes. Search
 * keeps working, it just stops being clever.
 */

/** The facet params the parser can emit. Mirrors SearchVocabulary::COLUMNS. */
export type SearchFilterKey =
  | "category"
  | "type"
  | "length"
  | "grade"
  | "texture"
  | "thickness"
  | "source";

/**
 * Group titles, as the chip row shows them.
 *
 * MIRRORS SearchVocabulary::LABELS. The server sends a `group` with every
 * chip, but chips are advisory and `applied` — which is what we actually
 * filter on — carries bare param keys, so the titles have to exist here too.
 * Change one, change both.
 */
export const SEARCH_GROUP_LABELS: Record<SearchFilterKey, string> = {
  category: "Category",
  type: "Wig type",
  length: "Length",
  grade: "Hair grade",
  texture: "Texture / pattern",
  thickness: "Thickness",
  source: "Source",
};

/** One thing the parser understood from a shopper's sentence. */
export interface ParsedChip {
  param: string;
  /** Human group name, e.g. "Texture / pattern". */
  group: string;
  /** Exact catalogue value — safe to apply as a filter. */
  value: string;
  label: string;
  /** 0–1: how completely the shopper's words covered the stored value. */
  confidence: number;
  /** True when this had to be dropped to avoid a zero-result page. */
  relaxed?: boolean;
}

/**
 * GET /products/interpret — a sentence read as structured filters.
 * `applied` is authoritative: it is what actually produced `total`.
 */
export interface InterpretResult {
  query: string;
  chips: ParsedChip[];
  /** Understood but non-discriminating words (e.g. "wig" on an all-wig shop). */
  ignored: string[];
  /** Filters dropped because keeping them all would have returned nothing. */
  relaxed: { param: string; label: string; group: string }[];
  /** True when a price band came from a vague word ("cheap"), not a number. */
  soft_price: boolean;
  applied: {
    filters: Partial<Record<SearchFilterKey, string[]>>;
    min: number | null;
    max: number | null;
    q: string;
  };
  total: number;
}

/** One type-ahead match under the search field. */
export interface ProductSuggestion {
  id: number;
  slug: string;
  name: string;
  spec: string;
  category: string;
  /** LIST price in whole ₦. */
  price: number;
  /** What the customer pays, discounted server-side. Prefer this. */
  sale_price?: number | null;
  discount_percent?: number | null;
  image?: string | null;
}

/** GET /products/suggest — the top matches plus the full tally. */
export interface SearchSuggestions {
  query: string;
  products: ProductSuggestion[];
  /** Total matches, so the panel can offer "see all N results". */
  total: number;
  /** Live preview of how the sentence is being read (high-confidence only). */
  parsed?: ParsedChip[];
}

/**
 * What the shop acts on: the server's `applied` block, plus the notes that
 * explain it.
 *
 * `category` is deliberately absent from `filters` by the time this reaches
 * the shop screen — see `splitCategory` — because the shop already HAS a
 * control for category (the rail) and two controls for one filter is how a
 * shopper ends up unable to undo the one they can see.
 */
export interface ParsedQuery {
  filters: Partial<Record<SearchFilterKey, string[]>>;
  min: number | null;
  max: number | null;
  /** Words the vocabulary did not recognise — matched as free text. */
  residual: string;
  /** Filters the server dropped to avoid a zero-result page. */
  relaxed: { param: string; label: string; group: string }[];
  /** Understood but non-discriminating words. */
  ignored: string[];
  /** The budget came from a vague word ("cheap"), not a figure. */
  softPrice: boolean;
}

/** Narrow `/products/interpret`'s reply to what the shop acts on. */
export function toParsedQuery(r: InterpretResult): ParsedQuery {
  return {
    // `applied`, never `chips`: see the relaxation note at the top.
    filters: (r.applied.filters ?? {}) as Partial<Record<SearchFilterKey, string[]>>,
    min: r.applied.min,
    max: r.applied.max,
    residual: r.applied.q ?? "",
    relaxed: r.relaxed ?? [],
    ignored: r.ignored ?? [],
    softPrice: Boolean(r.soft_price),
  };
}

/**
 * A sentence the parser could not reach, treated as plain keywords.
 *
 * Retiring the previous parse is the whole point of having this rather than
 * `null`: leaving the last sentence's facets applied and ANDing the new words
 * in as free text is a guaranteed empty page, captioned with a confident
 * reading of a query that was never parsed.
 */
export function keywordsOnly(sentence: string): ParsedQuery {
  return {
    filters: {},
    min: null,
    max: null,
    residual: sentence.trim(),
    relaxed: [],
    ignored: [],
    softPrice: false,
  };
}

/** Does this parse narrow anything beyond its free text? */
export function hasFacets(p: ParsedQuery | null): boolean {
  if (!p) return false;

  return (
    p.min !== null ||
    p.max !== null ||
    Object.values(p.filters).some((v) => (v?.length ?? 0) > 0)
  );
}

/** The catalogue categories, so a parsed one can drive the shop's rail. */
const CATEGORY_KEYS: Category[] = ["wigs", "bundles", "frontals", "closures"];

/**
 * Lift a parsed category out of the filter map.
 *
 * The shop's category rail is the shopper's own control, and it is visible: if
 * a sentence says "bundles" the rail has to MOVE, or it reads "All" over a
 * grid of bundles only — and the chip that could undo it is the only honest
 * way back, which is a worse arrangement than simply moving the pill.
 */
export function splitCategory(p: ParsedQuery): {
  category: Category | null;
  parsed: ParsedQuery;
} {
  const wanted = p.filters.category ?? [];
  // Exactly one, and a real catalogue category: anything else (two categories
  // in one sentence) stays a filter, because the rail is single-select and
  // silently honouring the first would drop the second.
  const only = wanted.length === 1 ? wanted[0]?.toLowerCase() : undefined;
  const category = CATEGORY_KEYS.find((c) => c === only) ?? null;
  if (!category) return { category: null, parsed: p };

  const { category: _lifted, ...rest } = p.filters;

  return { category, parsed: { ...p, filters: rest } };
}

/** The parse as query parameters, ready to merge with the filter sheet's. */
export function parsedQueryParams(p: ParsedQuery | null): Partial<ProductQuery> {
  if (!p) return {};
  const out: Partial<ProductQuery> = {};
  // Every key here is one `getProducts` knows how to send; a param the parser
  // emits that this app cannot filter on would be silently ignored, so the
  // map is kept exhaustive over SearchFilterKey rather than hand-picked.
  if (p.filters.length?.length) out.length = p.filters.length;
  if (p.filters.grade?.length) out.grade = p.filters.grade;
  if (p.filters.texture?.length) out.texture = p.filters.texture;
  if (p.filters.type?.length) out.type = p.filters.type;
  if (p.filters.thickness?.length) out.thickness = p.filters.thickness;
  if (p.filters.source?.length) out.source = p.filters.source;
  if (p.min !== null) out.min = p.min;
  if (p.max !== null) out.max = p.max;
  // The leftover words only — NOT the whole sentence. "18 inch body wave
  // under 200k" appears in no product name, so sending it as `q` matches
  // nothing however well the facets were understood.
  if (p.residual.trim()) out.q = p.residual.trim();

  return out;
}

/** Drop one inferred value, because the shopper said they did not mean it. */
export function withoutParsedValue(
  p: ParsedQuery,
  key: SearchFilterKey,
  value: string,
): ParsedQuery {
  const rest = (p.filters[key] ?? []).filter((v) => v !== value);
  const filters = { ...p.filters };
  if (rest.length) filters[key] = rest;
  else delete filters[key];

  return { ...p, filters };
}

/** Drop the inferred budget. */
export function withoutParsedPrice(p: ParsedQuery): ParsedQuery {
  return { ...p, min: null, max: null, softPrice: false };
}

/**
 * Read a sentence into filters. Returns null when the parser cannot be
 * reached, so the caller can fall back to `keywordsOnly`.
 */
export async function interpretSearch(
  sentence: string,
  signal?: AbortSignal,
): Promise<InterpretResult | null> {
  const q = sentence.trim().slice(0, 512);
  if (!q) return null;

  try {
    return await request<InterpretResult>(
      `/products/interpret?q=${encodeURIComponent(q)}`,
      { signal },
    );
  } catch {
    // Unreachable, unconfigured, or superseded by a newer keystroke. Either
    // way there is no parse, and inventing one is not an option.
    return null;
  }
}

/**
 * Type-ahead matches. The caller debounces on top of the server's own
 * throttle and passes a signal, so a slow early keystroke can never overwrite
 * a newer result.
 */
export async function getProductSuggestions(
  q: string,
  signal?: AbortSignal,
): Promise<SearchSuggestions> {
  const term = q.trim().slice(0, 60);
  const empty: SearchSuggestions = { query: term, products: [], total: 0 };
  // Match the server's floor: one character is too broad to be useful, and it
  // answers an empty list anyway.
  if (term.length < 2) return empty;

  try {
    return await request<SearchSuggestions>(
      `/products/suggest?q=${encodeURIComponent(term)}`,
      { signal },
    );
  } catch {
    // Show nothing rather than something stale.
    return empty;
  }
}

/** What the customer pays for a suggested product's opening variant. */
export function suggestionPrice(p: ProductSuggestion): number {
  // Never recomputed from `discount_percent` here: the server rounds the
  // discount the same way the charge does, and a client that rounds where the
  // server floors is out by a Naira on about half of all prices.
  return p.sale_price ?? p.price;
}
