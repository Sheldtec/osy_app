import type { PaymentMethodId } from "./checkout-api";
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

/** How a manual payment is actually made. Arrives with the invoice, not once. */
export interface ManualPaymentInstructions {
  type: "bank_transfer" | "crypto";
  /** The narration the shop matches a transfer against. Never rotates. */
  reference: string | null;
  amount: number;
  /**
   * Where to send it — null when the shop cannot take this method any more.
   *
   * It can go away under a standing invoice: the details are admin-managed, so
   * an order placed as a bank transfer outlives the switch being turned off.
   * Null means "pick another method", which `OrderInvoice.methods` confirms;
   * the reference above stays valid either way, because money already on its
   * way still has to find this order.
   */
  bank?: {
    bank_name?: string;
    account_name?: string;
    account_number?: string;
  } | null;
  crypto?: {
    usdt_address?: string;
    usdt_network?: string;
    btc_address?: string;
  } | null;
}

/**
 * An unpaid order, as something that can still be PAID.
 *
 * Present on every read of an order that is awaiting money, and null on every
 * other one — so `invoice !== null` is the whole test for "is there something
 * to pay here". It used to be re-derived on each screen from `status`,
 * `paid_at` and `amount_received`, which is three chances to disagree with the
 * server about whether a customer owes money.
 *
 * There is deliberately no deadline: orders in this shop have no expiry, and a
 * date the server would not act on is worse than none, because the customer
 * would plan around it.
 */
export interface OrderInvoice {
  /** The SERVER's own answer to "will POST /orders/{id}/pay work right now". */
  payable: boolean;
  /** Why it will not, when it will not. Show this verbatim — it is specific. */
  reason: string | null;
  /** What is still owed, in ₦. Net of anything the shop has already received. */
  amount_due: number;
  /** The method currently chosen. Changeable while the order is unpaid. */
  method: PaymentMethodId | null;
  /**
   * A card payment the customer has been sent off to make.
   *
   * The order is genuinely still unpaid, but for those minutes "pay it again"
   * is the wrong thing to offer — it is how one order collects two real
   * charges. Lead with `check_ref` instead.
   */
  awaiting: boolean;
  /** An unanswered payment's reference, to resume verifying rather than re-charge. */
  check_ref: string | null;
  /** Which methods the shop can take right now. Offer nothing else. */
  methods: Record<PaymentMethodId, boolean>;
  /** Bank or crypto details — present only while a manual method is chosen. */
  instructions: ManualPaymentInstructions | null;
  placed_at: string | null;
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
    /**
     * How the parcel physically travels, and the two are not variations of one
     * another: a `waybill` goes with an inter-state transport company and the
     * customer COLLECTS it at a terminal, a `logistics` courier brings it to
     * the door. Null until the team dispatches.
     */
    fulfilment_type: "waybill" | "logistics" | null;
    /** Transport company on a waybill, courier on a logistics shipment. */
    courier: string | null;
    /** Waybill number or tracking number, depending on `fulfilment_type`. */
    tracking_number: string | null;
    /** Waybill only: the park/terminal the parcel is released at. */
    pickup_terminal: string | null;
    /** The delivery note left on the order at checkout. */
    note: string | null;
  };
  totals: { subtotal: number; delivery: number; discount: number; total: number };
  amount_received: number;
  coupon_code: string | null;
  payment_method: string | null;
  /** Set when a newer attempt replaced this one — not a failure of theirs. */
  superseded_by: string | null;
  /**
   * The shop's own message about this order.
   *
   * Named for where it is written (the admin order screen) rather than for who
   * reads it: the server used to send it to admins only and now sends it to the
   * buyer as well, so the app presents it as a message FROM the shop.
   */
  admin_note: string | null;
  /**
   * What is owed and how to pay it — null unless this order is awaiting money.
   *
   * The order record exists from before payment, so an unpaid one is an
   * invoice: it can be paid now, by a different method than the one chosen at
   * checkout, from this screen.
   */
  invoice: OrderInvoice | null;
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
 * The order with this REFERENCE, or null if the customer has no such order.
 *
 * It reads the whole list because there is no lookup-by-reference endpoint and
 * the one place that needs this has nothing else to go on: after a payment,
 * all the confirm screen holds is the `LX-` reference from
 * `GET /payments/verify` — the create response's `order_id` is that same
 * reference, not the numeric id every order route binds on.
 *
 * The cost is the whole (server-capped) list for one order, which is the same
 * call the orders screen already makes on every visit, and the order being
 * looked for was placed seconds ago so it is at the front of it.
 */
export async function findMyOrderByRef(ref: string): Promise<Order | null> {
  const orders = await getMyOrders();

  return orders.find((o) => o.ref === ref) ?? null;
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

export interface OrderPaymentStarted {
  /** The order, re-read after the attempt. Replace local state with this. */
  order: Order;
  /** True ONLY for a wallet payment, which settles inside the request. */
  paid: boolean;
  /** Wallet only — the balance left afterwards. */
  wallet_balance?: number;
  /** Gateway only — the hosted checkout to open. */
  payment_url?: string;
  /** Gateway only — the reference `verifyPayment` resolves. */
  tx_ref?: string;
  /** Manual methods only — where to send the money, and what to quote. */
  instructions?: ManualPaymentInstructions;
}

/**
 * Pay an order that already exists, or change the method on it.
 *
 * No amount is ever sent. The server re-prices the charge from the order's own
 * stored total, read back under a row lock, so a figure a screen showed a
 * minute ago can never become what is debited — and the client names a METHOD,
 * nothing else.
 *
 * A WALLET payment is finished when this resolves (`paid: true`). A GATEWAY
 * payment is NOT: it comes back with `payment_url` and nothing has moved yet,
 * and the order is paid only once the server has verified the transaction with
 * the provider. Treat a returned link as "go and pay", never as "paid". A
 * MANUAL method comes back with instructions and stays unpaid until a person at
 * the shop records the receipt.
 *
 * No currency is sent, exactly as `createOrder` sends none: this app is charged
 * in Naira whatever currency it is displaying, and says so on every screen that
 * takes money. The endpoint accepts a currency for the website, which offers
 * that choice; adding it here would change what a customer is charged with no
 * screen asking them first.
 */
export async function payOrder(
  id: number,
  method: PaymentMethodId,
): Promise<OrderPaymentStarted> {
  return request<OrderPaymentStarted>(`/orders/${id}/pay`, {
    method: "POST",
    body: { method },
    auth: true,
  });
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
  /**
   * Where it may be spent.
   *
   * The API identifies the client that asked, so public offers for the other
   * channel never reach us — but a WEBSITE-ONLY coupon this customer holds
   * does, and the screen labels it instead of hiding it.
   */
  channel: "web" | "app" | "both";
  channel_label: string | null;
  status: "available" | "used" | "expired";
  /**
   * Live, but not open yet — `starts_at` is in the future.
   *
   * Decided by the SERVER's clock, which is the clock that will accept or
   * refuse the code. These used to arrive as `expired`, because one window
   * check answered for both ends of it, so a coupon the shop was about to
   * honour was filed under the one heading that says "forget about it".
   */
  scheduled: boolean;
}

export interface CouponWallet {
  available: CouponCard[];
  used: CouponCard[];
  expired: CouponCard[];
  counts: { all: number; available: number; used: number; expired: number };
}

/**
 * The customer's coupons: ones they hold, plus every live public offer they
 * qualify for — so a valid one surfaces without them knowing the code.
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
