import Constants from "expo-constants";
import { Platform } from "react-native";

import { MOCK_DETAILS, MOCK_PRODUCTS } from "./data";
import type {
  Collection,
  PreparationOption,
  Product,
  ProductDetail,
  ProductFacets,
} from "./types";

/**
 * Fetch layer.
 *
 * When EXPO_PUBLIC_API_URL is set we hit the Laravel API (shapes in
 * API-CONTRACT.md) and a failure SURFACES — see ApiUnavailableError. When it
 * is unset we serve the mock catalogue so every screen renders standalone,
 * which the brief requires while the backend is being pointed at.
 *
 * The distinction matters: falling back to mocks on a live-API error would
 * show six invented products in place of a real 124-product catalogue, and
 * look for all the world like a working app.
 */

const RAW = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

/** Private/loopback hosts — the ones that are only meaningful on one network. */
const PRIVATE_HOST =
  /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * The machine Metro is being served from, in development.
 *
 * `hostUri` is the address this device is ALREADY talking to for the JS bundle
 * (e.g. "192.168.179.175:8081"), so unlike anything in .env it cannot be stale
 * and cannot be unreachable — if it were, there would be no app running to ask.
 */
function devHost(): string | null {
  if (!__DEV__) return null;

  // On web the page itself is the ground truth, and `hostUri` is often absent
  // there — which left the browser calling whatever stale LAN IP was in .env
  // and timing out, with the rewrite that exists to prevent exactly that
  // silently not firing.
  if (Platform.OS === "web") {
    const host = typeof window !== "undefined" ? window.location?.hostname : null;

    return host || null;
  }

  const uri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    null;

  return uri ? (uri.split("/")[0]?.split(":")[0] ?? null) : null;
}

/**
 * `localhost` means the phone itself, not your laptop, so it is wrong nearly
 * everywhere in mobile development. A physical device needs the dev machine's
 * LAN IP — and that address is NOT a constant: it changes with a DHCP lease or
 * a different network, at which point a hardcoded one in .env points at a host
 * that no longer exists. The API is then configured but unreachable, which by
 * design does not fall back to mocks, so every screen fails to load and the
 * cause looks nothing like "the IP moved".
 *
 * So in development the host is taken from Metro, which is ground truth, and
 * the env var supplies the port and path. A NON-private host in the env (a real
 * staging or production domain) is always honoured as-is — only a private
 * address, which is the kind that goes stale, gets corrected.
 */
export const API_BASE = ((): string => {
  if (!RAW) return "";

  let url: URL;
  try {
    url = new URL(RAW);
  } catch {
    return RAW; // not parseable — leave it exactly as configured
  }

  // A real domain is deliberate configuration; never second-guess it.
  if (!PRIVATE_HOST.test(url.hostname)) return RAW;

  const host = devHost();
  if (host && host !== url.hostname) {
    url.hostname = host;

    return url.toString().replace(/\/$/, "");
  }

  // No Metro host to learn from (a production build, or a bare emulator).
  // The Android emulator reaches its host at the fixed address 10.0.2.2.
  if (Platform.OS === "android" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    url.hostname = "10.0.2.2";

    return url.toString().replace(/\/$/, "");
  }

  return RAW;
})();

/**
 * The API gates its PUBLIC endpoints on a client key (backend/config/clients.php)
 * and answers 401 without one — so every request here carries it, or the whole
 * catalogue silently falls back to mock data.
 *
 * This key IS embedded in the app binary and can be extracted. That is
 * expected: it buys attribution and per-client rate limiting, not secrecy.
 * Give the app its OWN key (API_CLIENT_KEY_MOBILE) — never the web one, or
 * revoking a leaked mobile key takes the website down with it. Real
 * authorisation is the per-user bearer token in lib/auth.tsx.
 */
const CLIENT_KEY = process.env.EXPO_PUBLIC_API_CLIENT_KEY ?? "";

/** Headers every call to the API needs. Exported so lib/auth can reuse them. */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    ...(CLIENT_KEY ? { "X-Client-Key": CLIENT_KEY } : {}),
    ...extra,
  };
}

/**
 * The API was configured but did not answer usefully.
 *
 * This type exists so a live-but-broken backend cannot be papered over with
 * mock products. Showing six invented pieces when the real catalogue holds 124
 * is a broken app that LOOKS like a working one — the worst failure mode
 * available. Mock data is now served ONLY when no API is configured at all.
 */
export class ApiUnavailableError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiUnavailableError";
    this.status = status;
  }
}

const TIMEOUT_MS = 8000;

async function tryFetch<T>(path: string): Promise<T | null> {
  // No backend pointed at yet — the supported "run on mocks" mode.
  if (!API_BASE) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: apiHeaders(),
      signal: controller.signal,
    });

    if (!res.ok) {
      // A rejected client key is worth naming: it looks exactly like "API
      // down" but is a one-line fix.
      if (res.status === 401) {
        console.error(
          `[api] ${path} → 401. The API rejected this client. Is EXPO_PUBLIC_API_CLIENT_KEY ` +
            "set and matching API_CLIENT_KEY_MOBILE in backend/.env?",
        );
        throw new ApiUnavailableError("This app is not authorised to reach the store.", 401);
      }
      throw new ApiUnavailableError(`The store returned an error (${res.status}).`, res.status);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiUnavailableError) throw err;
    throw new ApiUnavailableError(
      controller.signal.aborted
        ? "The store took too long to answer. Check your connection."
        : "Could not reach the store. Check your connection.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface Paginated<T> {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
}

/**
 * The host the API is served from, without its `/api` path.
 *
 * Derived from API_BASE rather than from the env var, deliberately: API_BASE
 * has already had a stale private host swapped for the one Metro is actually
 * being served from, so image URLs follow the dev machine's address around
 * exactly as API calls do. Reading RAW here would point photos at an IP that
 * moved three DHCP leases ago while the rest of the app worked fine.
 */
export const API_ORIGIN = (() => {
  if (!API_BASE) return "";
  const m = /^(https?:\/\/[^/]+)/i.exec(API_BASE);

  return m ? m[1] : "";
})();

/**
 * A product photo this device can actually fetch, or null.
 *
 * `Product.image` is not always a URL. Most of this catalogue stores
 * ROOT-RELATIVE paths like `/images/catalogue/body-wave-bundles.jpg` — 115 of
 * 125 products at the time of writing. On the website those resolve against
 * the page's own origin and just work; handed to a phone's
 * `<Image source={{uri}}>` they resolve against nothing and render an
 * invisible box. That is why most of the catalogue appeared to have no photos
 * in the app while looking fine in a browser.
 *
 * So a root-relative path is resolved against the API origin, which now serves
 * those files (`backend/public/images/catalogue/`). Absolute URLs — the
 * Cloudinary ones the admin uploads — pass through untouched, which also makes
 * this function IDEMPOTENT: it is safe to apply at the API boundary and again
 * at render time, and the second pass is a no-op.
 *
 * Anything else still comes back null, which is what `HairImage` wants in
 * order to draw the designed tonal placeholder. A placeholder is a deliberate
 * surface; a blank box is a bug the shopper can see.
 */
export function resolveImage(image?: string | null): string | null {
  if (!image) return null;

  // A rendered try-on result. Carries its own bytes; nothing to resolve.
  if (/^data:/i.test(image)) return image;

  if (/^https?:\/\//i.test(image)) {
    // An absolute URL is normally final — Cloudinary, or a real domain.
    //
    // The exception is a DEV url whose host has since moved. The wishlist
    // persists a product's image to disk (lib/wishlist.tsx), so a URL resolved
    // against yesterday's DHCP lease outlives that lease: every API call keeps
    // working, because API_BASE re-homes itself to whatever host Metro is on,
    // while the saved photos quietly stop loading. Give image URLs the same
    // treatment, for the same reason.
    //
    // Only PRIVATE hosts are rewritten. A real domain is deliberate
    // configuration and is never second-guessed — the rule API_BASE already
    // applies to itself.
    const parts = /^https?:\/\/([^/:]+)(?::\d+)?(\/.*)?$/i.exec(image);
    if (parts && API_ORIGIN && PRIVATE_HOST.test(parts[1])) {
      return API_ORIGIN + (parts[2] ?? "");
    }

    return image;
  }

  // Only a root-relative path can be placed with confidence. A bare
  // "photo.jpg" could be relative to anything, and guessing would produce a
  // URL that 404s instead of a placeholder that looks intentional.
  if (!image.startsWith("/")) return null;

  // No API configured (the mock mode): nothing is serving these files.
  if (!API_ORIGIN) return null;

  return API_ORIGIN + image;
}

/** A product with every image field resolved. Idempotent; safe to re-apply. */
function withImages<T extends { image?: string | null; images?: string[] }>(p: T): T {
  const next: T = { ...p, image: resolveImage(p.image) };

  // The PDP gallery reads `images[]`, which carries the same relative paths and
  // is rendered by a RAW <Image source={{uri}}> rather than through HairImage —
  // so it has no placeholder to fall back on and must be fixed here.
  if (Array.isArray(p.images)) {
    next.images = p.images
      .map((i) => resolveImage(i))
      .filter((i): i is string => i !== null);
  }

  return next;
}

/** One page of the catalogue, plus the full tally behind it. */

export interface ProductPage {
  items: Product[];
  /** Every product matching the filters — NOT the length of `items`. */
  total: number;
  page: number;
  lastPage: number;
}

export interface ProductQuery {
  category?: string;
  /** Admin-curated collection key (hot-deals, new-arrivals…). Server-side filter. */
  collection?: string;
  /** Free-text search. Sent as ?q= — the same parameter the website uses. */
  q?: string;
  sort?: string;
  /** Price band in whole Naira. */
  min?: number;
  max?: number;
  /** Multi-select facets. Sent comma-joined, which is what the API parses. */
  length?: string[];
  grade?: string[];
  lace?: string[];
  texture?: string[];
  /** Wig type, thickness (density), origin and cap construction — the
   *  remaining whitelisted facet columns in ProductController::buildIndex. */
  type?: string[];
  thickness?: string[];
  source?: string[];
  cap?: string[];
  page?: number;
  per_page?: number;
}

export async function getProducts(params: ProductQuery = {}): Promise<ProductPage> {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.collection) qs.set("collection", params.collection);
  if (params.q) qs.set("q", params.q);
  if (params.sort) qs.set("sort", params.sort);
  if (params.min) qs.set("min", String(params.min));
  if (params.max) qs.set("max", String(params.max));
  // Comma-joined, not repeated or bracketed — that is the shape
  // ProductController parses. Getting it wrong fails OPEN: the API ignores the
  // parameter and returns an unfiltered catalogue.
  for (const key of [
    "length",
    "grade",
    "lace",
    "texture",
    "type",
    "thickness",
    "source",
    "cap",
  ] as const) {
    const values = params[key];
    if (values?.length) qs.set(key, values.join(","));
  }
  if (params.page) qs.set("page", String(params.page));
  // Clamped, not passed through. ProductController applies only min(n, 60),
  // so a negative page size reaches paginate() and returns a 500 whose body
  // leaks the SQL statement, table and column names to the client.
  if (params.per_page) {
    qs.set("per_page", String(Math.max(1, Math.min(Math.floor(params.per_page), 60))));
  }

  const remote = await tryFetch<Paginated<Product>>(
    `/products${qs.toString() ? `?${qs}` : ""}`,
  );
  if (remote?.data) {
    return {
      // Resolved HERE, at the boundary, so every downstream consumer — the
      // card grids, the cart, Thumb, the concierge's recommendations, try-on's
      // style rail — sees a URL it can actually load. Fixing it per-screen is
      // how a screen gets forgotten.
      items: remote.data.map(withImages),
      total: remote.meta?.total ?? remote.data.length,
      page: remote.meta?.current_page ?? 1,
      lastPage: remote.meta?.last_page ?? 1,
    };
  }

  // Mock path — reached ONLY when no API is configured (tryFetch throws
  // otherwise). Honour every filter the screens send so a category tap, a
  // search or a sort is not a silent no-op in that mode. The mock catalogue
  // carries no facet columns, so facet filters are not applied here; the sheet
  // only offers what the LIVE facets endpoint returns, which is empty anyway.
  let list = MOCK_PRODUCTS;

  if (params.category) list = list.filter((p) => p.category === params.category);

  if (params.q) {
    const term = params.q.trim().toLowerCase();
    list = list.filter((p) =>
      [p.name, p.spec ?? "", p.category].some((f) => f.toLowerCase().includes(term)),
    );
  }

  if (params.min) list = list.filter((p) => p.price >= params.min!);
  if (params.max) list = list.filter((p) => p.price <= params.max!);

  list = sortProducts(list, params.sort);

  // Slice the REQUESTED page, not always the first. An infinite list that
  // appends would otherwise re-add the same rows on every fetch — duplicate
  // React keys and a list that never ends. The mock catalogue is small, so
  // this usually yields exactly one page, which is the truth: it is not
  // taught to fake extra pages by repeating products.
  const perPage = params.per_page ? Math.max(1, Math.floor(params.per_page)) : list.length || 1;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const items = list.slice((page - 1) * perPage, page * perPage);

  return {
    items,
    total: list.length,
    page,
    lastPage: Math.max(1, Math.ceil(list.length / perPage)),
  };
}

/** The sorts the API contract defines, applied locally for the mock path. */
function sortProducts(list: Product[], sort: string | undefined): Product[] {
  const out = [...list];
  switch (sort) {
    case "price_asc":
      return out.sort((a, b) => a.price - b.price);
    case "price_desc":
      return out.sort((a, b) => b.price - a.price);
    case "newest":
      return out.sort((a, b) => b.id - a.id);
    case "rating":
      return out.sort((a, b) => b.rating - a.rating);
    case "featured":
    default:
      // Most sold first, newest breaking ties — the API's default ordering.
      // The mock has no sold_count, so it falls through to newest-first.
      return out.sort((a, b) => (b.sold_count ?? 0) - (a.sold_count ?? 0) || b.id - a.id);
  }
}

/**
 * The filter sheet's options, from the LIVE catalogue.
 *
 * Returns null in mock mode rather than an invented set — a sheet offering
 * "HD Swiss lace" against a catalogue that has never heard of it would filter
 * to nothing and look broken.
 */
export function getFacets(): Promise<ProductFacets | null> {
  // Deliberately forgiving, unlike the catalogue: a missing facet group costs
  // a filter option, not a wrong page of products.
  return tryFetch<ProductFacets>("/products/facets").catch(() => null);
}

/**
 * The "Preparation & styling" add-ons on the product page.
 *
 * Forgiving like facets: losing this list costs a section, not a wrong price —
 * and the SERVER re-resolves every surcharge from its own table by key, so
 * nothing here is authoritative.
 */
/**
 * The two product shelves the admin configured for the storefront home.
 *
 * Read so the app uses the OWNER's chosen headings rather than inventing its
 * own — the same config the website renders from. Forgiving: losing it costs
 * two titles, and the shelves fall back to their own defaults.
 */
export interface StorefrontHome {
  featured?: { title?: string; source?: string };
  second?: { enabled?: boolean; title?: string; source?: string };
}

export function getStorefrontHome(): Promise<StorefrontHome | null> {
  return tryFetch<{ home?: StorefrontHome }>("/settings/storefront")
    .then((r) => r?.home ?? null)
    .catch(() => null);
}

/**
 * The admin's curated collections, newest-first by their configured order.
 *
 * Forgiving like facets: if this fails the home screen simply shows no
 * curated rows, which is a smaller lie than inventing one.
 */
export function getCollections(): Promise<{ data: Collection[] } | null> {
  return tryFetch<{ data: Collection[] }>("/collections").catch(() => null);
}

export function getPreparationOptions(): Promise<PreparationOption[] | null> {
  return tryFetch<PreparationOption[]>("/preparation-options").catch(() => null);
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const remote = await tryFetch<ProductDetail>(`/products/${slug}`);
  if (remote) {
    const resolved = withImages(remote);

    // The API omits collections that are empty; fill them so the screen never
    // has to guard every read.
    //
    // `images` is read off `resolved`, NOT off `remote`. Spreading the
    // resolved object and then re-listing `images: remote.images` put the raw
    // relative paths straight back — a later key wins in an object literal —
    // so the gallery stayed broken while the grids looked fixed. The singular
    // `image` had no such override, which is exactly what made it look like
    // the fix had worked.
    return {
      ...resolved,
      lengths: remote.lengths ?? [],
      colours: remote.colours ?? [],
      densities: remote.densities ?? [],
      images: resolved.images ?? [],
      reviews: remote.reviews ?? [],
      specs: Array.isArray(remote.specs) ? {} : (remote.specs ?? {}),
    };
  }
  // Unconfigured only — a live 404 has already thrown.
  return MOCK_DETAILS[slug] ?? null;
}

/*
 * Orders and payments used to live here. They now live in lib/checkout-api.ts,
 * because this module's contract — a live error surfaces, an unconfigured API
 * serves mocks — is right for a catalogue and wrong for money. The version
 * removed from here invented an `LX-#####` reference on any network failure,
 * and the checkout screen cleared the bag and rendered it as a receipt.
 */
