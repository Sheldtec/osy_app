export type Category = "wigs" | "bundles" | "frontals" | "closures";

export interface Product {
  id: number;
  slug: string;
  name: string;
  category: Category;
  /** The API sends null when a product has no spec line. */
  spec: string | null;
  price: number;          // integer Naira, the LIST price
  /** Percentage off, 0-90. The server applies it; this app only displays it. */
  discount_percent?: number | null;
  /** What the customer pays, computed server-side with the same rounding the
   *  charge uses. Never recompute it here: a client that rounds where the
   *  server floors is out by a Naira on about half of all prices. */
  sale_price?: number | null;
  /** LIST price per length, when the admin overrode any. */
  length_prices?: Record<string, number>;
  /** The same rungs already discounted by the server — prefer these. */
  sale_length_prices?: Record<string, number>;
  rating: number;
  reviews_count: number;
  /** Units sold. Present in the API response; absent from the mock. */
  sold_count?: number;
  image?: string | null;
  badge?: string | null;
  code_prefix?: string;   // "LX"
}

/** One customer review, as GET /products/{slug} returns them. */
export interface Review {
  author: string;
  location: string;
  rating: number;   // 1–5
  body: string;
  variant: string;  // the length they bought, e.g. '16"'
  date: string;     // ISO date
  verified: boolean;
}

export interface ProductDetail extends Product {
  description: string;
  lengths: string[];
  /** Name-only by owner decision; the API no longer sends a swatch hex. */
  colours: { name: string; hex?: string }[];
  densities: string[];
  specs: Record<string, string>;
  images: string[];
  reviews: Review[];
}

/** One style sub-choice under a preparation option (curl / pinning / …). */
export interface PreparationStyleOption {
  value: string;
  label: string;
  /** Extra ₦ on top of the option's own surcharge. */
  price?: number;
}

/** GET /preparation-options — the admin-managed add-ons on the product page. */
export interface PreparationOption {
  id: string;
  title: string;
  caption: string;
  /** Whole ₦ added per unit. 0 renders as Included. */
  surcharge: number;
  default?: boolean;
  /** True when the option requires a style pick — the API REJECTS an order
   *  that omits one, so the picker must always keep a style selected. */
  has_style?: boolean;
  style_options?: PreparationStyleOption[];
}

export interface CartLine {
  product: Product;
  length?: string;
  colour?: string;
  qty: number;
  /** Preparation option id, e.g. wigging. */
  preparation?: string;
  /** Its title, snapshotted so the bag survives an admin renaming it. */
  preparationTitle?: string;
  preparationStyle?: string;
  preparationStyleLabel?: string;
  /** Per-unit ₦ for option + style. DISPLAY ONLY — the server re-resolves it
   *  from the canonical table by key and ignores whatever we send. */
  surcharge?: number;
}

/** One selectable filter option, with how many products carry it. */
export interface Facet {
  value: string;
  count: number;
}

/** GET /products/facets — the live catalogue's own filter options. */
export interface ProductFacets {
  categories: Facet[];
  wig_types: Facet[];
  lengths: Facet[];
  grades: Facet[];
  laces: Facet[];
  textures: Facet[];
  caps: Facet[];
  thicknesses: Facet[];
  sources: Facet[];
  price: { min: number; max: number };
}

/** GET /wallet — store credit, its ledger and the cash-out surface. */
export interface WalletTransaction {
  id: number;
  /** Signed whole Naira: negative is a debit. */
  amount: number;
  type: string;
  label: string;
  at: string | null;
}

/** A cash-out request. The account number is masked for the owner. */
export interface WalletWithdrawal {
  id: number;
  ref: string;
  amount: number;
  /** pending: queued for manual payout · paid · rejected · cancelled by you. */
  status: "pending" | "paid" | "rejected" | "cancelled";
  bank_name: string;
  account_hint: string;
  account_name: string;
  /** Why it was rejected, when it was. */
  note: string | null;
  at: string | null;
  paid_at: string | null;
}

/**
 * A manual BANK-TRANSFER top-up that is not yet a settled credit.
 *
 * Gateway top-ups never appear here — once verified they show up as a normal
 * `topup` credit in `transactions`, so listing them in both places would
 * double-count them on screen.
 */
export interface WalletPendingTopup {
  id: number;
  ref: string;
  /** The unguessable reference the customer must quote on the transfer. */
  reference: string;
  amount: number;
  /** pending: awaiting our confirmation · failed: declined · cancelled by you. */
  status: "pending" | "failed" | "cancelled";
  at: string | null;
  /** Our account details — only carried while the row is still pending. */
  bank: {
    bank_name: string | null;
    account_name: string | null;
    account_number: string | null;
  } | null;
}

export interface Wallet {
  balance: number;
  welcome: { amount: number; enabled: boolean; claimed: boolean; eligible: boolean };
  /** Earned income that may be cashed out — NOT the whole balance. */
  withdrawable: number;
  income_earned: number;
  withdrawal_min: number;
  withdrawals_enabled: boolean;
  transactions: WalletTransaction[];
  withdrawals: WalletWithdrawal[];
  pending_topups: WalletPendingTopup[];
}

/**
 * An admin-curated shelf ("Hot Deals", "New Arrivals").
 *
 * `product_count` is what the shop actually has in it — the app reads it to
 * decide whether a collection is worth a whole row, rather than assuming.
 */
export interface Collection {
  key: string;
  title: string;
  subtitle: string | null;
  in_nav: boolean;
  sort_order: number;
  product_count: number;
}
