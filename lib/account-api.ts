import { request } from "./http";

/**
 * The signed-in customer's own area: orders, coupons, membership, hair profile.
 *
 * Every endpoint here is `auth:sanctum`, so each call carries the bearer token
 * and a 401 means the session expired rather than "not found". None of them has
 * a mock: an invented order history or coupon wallet is indistinguishable from
 * a real one, and the customer acts on it.
 */

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

export type OrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface OrderItem {
  id: number;
  name: string;
  slug: string | null;
  image: string | null;
  length: string | null;
  colour: string | null;
  density: string | null;
  preparation: string | null;
  preparation_style: string | null;
  qty: number;
  unit_price: number;
  surcharge: number;
  line_total: number;
  /** The unit's own traceable codes, once allocated. */
  codes: string[];
}

export interface Order {
  id: number;
  ref: string;
  status: OrderStatus;
  customer: { name: string; phone: string | null; email: string | null };
  delivery: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
    method: string | null;
    courier: string | null;
    tracking_number: string | null;
    note: string | null;
  };
  totals: { subtotal: number; delivery: number; discount: number; total: number };
  amount_received: number;
  coupon_code: string | null;
  payment_method: string | null;
  /** Set when a newer attempt replaced this one — not a failure of theirs. */
  superseded_by: string | null;
  items: OrderItem[];
  timeline: {
    placed_at: string | null;
    paid_at: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
  };
}

/**
 * The status buckets, defined once.
 *
 * The profile tab counts orders into four tiles and the orders screen filters
 * by status; before this they were two separate notions of the same thing, so
 * a tile saying "12 Processing" could open a list filtered to a different 12.
 * Both now read these.
 *
 * They are buckets rather than raw statuses because the raw set has seven
 * values and several mean the same thing to a customer: `paid` and
 * `processing` are both "we're getting it ready", and `refunded` belongs with
 * `cancelled` under "didn't happen".
 */
export interface OrderBucket {
  key: string;
  label: string;
  match: (order: Order) => boolean;
}

export const ORDER_BUCKETS: OrderBucket[] = [
  { key: "to-pay", label: "To pay", match: (o) => o.status === "pending" },
  {
    key: "processing",
    label: "Processing",
    match: (o) => o.status === "paid" || o.status === "processing",
  },
  { key: "shipped", label: "Shipped", match: (o) => o.status === "shipped" },
  { key: "delivered", label: "Delivered", match: (o) => o.status === "delivered" },
  {
    key: "cancelled",
    label: "Cancelled",
    match: (o) => o.status === "cancelled" || o.status === "refunded",
  },
];

/** Newest first, capped at 100 by the server. */
export async function getMyOrders(): Promise<Order[]> {
  const res = await request<{ data: Order[] }>("/orders/mine", { auth: true });
  return res.data ?? [];
}

/** Binds on the NUMERIC id — `/orders/LX-XXXXXX` 404s. */
export async function getOrder(id: number): Promise<Order> {
  const res = await request<{ order: Order }>(`/orders/${id}`, { auth: true });
  return res.order;
}

/**
 * Cancel an order the shopper no longer wants.
 *
 * The server allows it only while nothing has been received: pending, unpaid,
 * and `amount_received` still zero, re-checked under a row lock so a payment
 * that wins the race keeps its money. Anything else comes back 422 with the
 * reason, which is the right thing to show.
 */
export async function cancelOrder(id: number): Promise<Order> {
  const res = await request<{ order: Order }>(`/orders/${id}/cancel`, {
    method: "POST",
    auth: true,
  });
  return res.order;
}

/* ------------------------------------------------------------------ *
 * Coupons
 * ------------------------------------------------------------------ */

export interface CouponCard {
  id: number;
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  /**
   * The raw discount amount in Naira (or the percentage, for `percent`).
   *
   * The two *_label strings below arrive from the server with a Naira sign
   * already in them, so they cannot follow the shopper's chosen currency.
   * This is the number they are built from — pass it to `couponLabels()` with
   * a formatter and build the label on the client instead.
   */
  value: number | null;
  discount_label: string;
  condition_label: string | null;
  description: string | null;
  min_spend: number | null;
  starts_at: string | null;
  ends_at: string | null;
  badge: string | null;
  /** Where it may be used. App-only cards are hidden — see the note below. */
  channel: "web" | "app" | "both";
  channel_label: string | null;
  status: "available" | "used" | "expired";
}

export interface CouponWallet {
  available: CouponCard[];
  used: CouponCard[];
  expired: CouponCard[];
  counts: { all: number; available: number; used: number; expired: number };
}

/**
 * The customer's codes: ones they hold, plus every live public coupon they
 * qualify for — so a valid offer surfaces without them knowing the code.
 */
export function getCoupons(): Promise<CouponWallet> {
  return request<CouponWallet>("/coupons", { auth: true });
}

/**
 * Add a code someone gave them.
 *
 * Idempotent: a code already held comes back 200 with `already: true` rather
 * than an error, so tapping twice is harmless.
 */
export function claimCoupon(code: string): Promise<{ coupon: CouponCard; already?: boolean }> {
  return request<{ coupon: CouponCard; already?: boolean }>("/coupons/claim", {
    method: "POST",
    auth: true,
    body: { code: code.trim().toUpperCase() },
  });
}

/* ------------------------------------------------------------------ *
 * Membership
 * ------------------------------------------------------------------ */

export interface VipApplication {
  id: number;
  status: string;
  business_name: string | null;
  business_type: string | null;
  cac_number: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  fee_amount: number | null;
  fee_due: number | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  fee_refunded: number;
}

export interface VipStatus {
  is_vip: boolean;
  vip_since: string | null;
  perks: string[];
  /** False when the shop has membership closed. Hide the join path entirely. */
  enabled: boolean;
  min_spend: number;
  fee: number;
  /** What this customer has actually spent, recomputed server-side. */
  spend: number;
  eligible: boolean;
  business_types: string[];
  application: VipApplication | null;
}

export function getVipStatus(): Promise<VipStatus> {
  return request<VipStatus>("/vip", { auth: true });
}

export interface VipApplyInput {
  business_name: string;
  business_type: string;
  cac_number?: string;
  phone: string;
}

/**
 * Apply for membership.
 *
 * Eligibility is recomputed from the customer's own orders on the server and
 * the figure shown on screen is never trusted — so the app may show the spend
 * gate, but must let the server be the one to refuse.
 */
export function applyForVip(input: VipApplyInput): Promise<VipStatus> {
  return request<VipStatus>("/vip/apply", { method: "POST", auth: true, body: input });
}

/** Pay the membership fee from the wallet, once an application is approved. */
export function payVipFee(): Promise<VipStatus> {
  return request<VipStatus>("/vip/pay", { method: "POST", auth: true });
}

/* ------------------------------------------------------------------ *
 * Hair profile
 * ------------------------------------------------------------------ */

/** The twelve fields, in the order the form shows them. */
export const HAIR_PROFILE_FIELDS = [
  "occupation",
  "skin_tone",
  "head_circumference",
  "head_hairline_to_nape",
  "head_ear_to_ear_over_top",
  "head_ear_to_ear_back",
  "hair_pattern",
  "hair_length",
  "parting_size",
  "daily_use_wig_color",
  "hair_color",
  "budget_for_wigs",
] as const;

export type HairProfileField = (typeof HAIR_PROFILE_FIELDS)[number];

export type HairProfile = Partial<Record<HairProfileField, string | null>>;

export interface HairProfileOption {
  value: string;
  label: string;
  /**
   * Budget bands only: the band's numeric edges in NAIRA — null for an open
   * end, both null for "No fixed budget".
   *
   * `value` here is also the STORED enum ("₦50,000 – ₦100,000" is literally
   * what the column holds), so the server cannot reword it and must post back
   * untouched. These numbers are how the band gets restated in the currency
   * the shopper is reading in; `moneyBandLabel()` does that. Absent on every
   * other field.
   */
  min?: number | null;
  max?: number | null;
}

export interface HairProfileResponse {
  data: HairProfile;
  /**
   * The allowed values per field, served by the shop — already `{value,
   * label}`, NOT bare strings.
   *
   * The label is doing real work on the measurements: the server renders
   * `22" (56 cm) — average`, so the inch value carries its centimetre
   * equivalent and marks the typical size. Re-wrapping these as if they were
   * strings both threw that away and put an object where React expected text.
   *
   * Server-owned on purpose: the colour and length lists are merged from the
   * live catalogue, so hard-coding them here would offer shades the shop has
   * stopped carrying.
   */
  options: Record<string, HairProfileOption[]>;
  saved_at: string | null;
}

export function getHairProfile(): Promise<HairProfileResponse> {
  return request<HairProfileResponse>("/preferences", { auth: true });
}

/**
 * Save the profile.
 *
 * A full replace, not a merge — every field can be set back to "no preference"
 * and a partial update gives no way to express clearing one. Always send all
 * twelve, with "" for the ones left blank.
 */
export function saveHairProfile(values: HairProfile): Promise<HairProfileResponse> {
  const body: Record<string, string> = {};
  for (const f of HAIR_PROFILE_FIELDS) body[f] = String(values[f] ?? "");

  return request<HairProfileResponse>("/preferences", { method: "PUT", auth: true, body });
}

/** Sentence-case a field name for a label: head_ear_to_ear_back → Ear to ear (back). */
export const HAIR_PROFILE_LABEL: Record<HairProfileField, string> = {
  occupation: "Occupation",
  skin_tone: "Skin tone",
  head_circumference: "Head circumference",
  head_hairline_to_nape: "Hairline to nape",
  head_ear_to_ear_over_top: "Ear to ear (over top)",
  head_ear_to_ear_back: "Ear to ear (back)",
  hair_pattern: "Hair pattern",
  hair_length: "Preferred length",
  parting_size: "Parting size",
  daily_use_wig_color: "Everyday wig colour",
  hair_color: "Hair colour",
  budget_for_wigs: "Budget",
};

/** The four measurements, grouped apart from the preferences on the form. */
export const HAIR_PROFILE_MEASUREMENTS: HairProfileField[] = [
  "head_circumference",
  "head_hairline_to_nape",
  "head_ear_to_ear_over_top",
  "head_ear_to_ear_back",
];
