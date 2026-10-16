import { request } from "./http";

/**
 * Checkout and payment HTTP.
 *
 * Kept out of lib/api.ts deliberately. That module's contract is "a live API
 * error surfaces, an unconfigured API serves mocks" — which is right for a
 * catalogue and wrong for money. There is no safe mock for placing an order or
 * confirming a payment: the previous `createOrder` invented an `LX-#####`
 * reference on any network error, and the screen cleared the bag and showed it
 * as a receipt. Nothing in this file ever fabricates a result.
 *
 * Everything here speaks one of two shapes:
 *   · PUBLIC  — needs X-Client-Key (payments, shipping). `apiHeaders()` adds it.
 *   · MEMBER  — needs the bearer token as well (orders, coupons, wallet).
 *
 * The token is read inside each call rather than passed in, matching the rest
 * of the app, so no call site can forget it and get an opaque 401.
 */

/**
 * `CheckoutError` is lib/http's ApiError under its original name, kept so the
 * checkout screens' `instanceof` checks and `err.field === "coupon"` branches
 * read the same as when this module owned the transport.
 */
export { ApiError as CheckoutError } from "./http";

/* ------------------------------------------------------------------ *
 * Payment methods
 * ------------------------------------------------------------------ */

export interface GatewayAvailability {
  available: boolean;
  /** True when the gateway is running without keys — no money will move. */
  test_mode?: boolean;
}

export interface PaymentMethods {
  flutterwave: GatewayAvailability;
  paystack: GatewayAvailability;
  bank_transfer: GatewayAvailability;
  crypto: GatewayAvailability;
}

/** The five ids POST /orders accepts. Anything else is a 422. */
export type PaymentMethodId =
  | "flutterwave"
  | "paystack"
  | "bank_transfer"
  | "crypto"
  | "wallet";

/**
 * Which methods the shop can actually take right now.
 *
 * The app must render from this rather than a hard-coded list: a gateway with
 * no key is refused server-side at order creation, so offering it means the
 * shopper fills in the whole form before being told. There is no `wallet`
 * entry — the wallet row is ours to add whenever someone is signed in, with
 * the balance from GET /wallet.
 */
export function getPaymentMethods(): Promise<PaymentMethods> {
  return request<PaymentMethods>("/payments/methods");
}

/* ------------------------------------------------------------------ *
 * Shipping
 * ------------------------------------------------------------------ */

export interface ShippingQuote {
  fee: number;
  express_fee: number;
  label: string;
  /** How specific the matched rate was. "fallback" means no zone covers them. */
  matched: "state" | "country" | "fallback";
}

export interface PickupOption {
  enabled: boolean;
  label: string;
  address: string;
  lead: string;
}

/**
 * What delivery will cost to this place.
 *
 * Display only, and it must be re-read from the order response: the charge is
 * whatever the server computes at creation from its own zone table. The app
 * previously hard-coded `delivery = 0` for a "birthday month" rule that has no
 * server implementation, so a shopper could be charged ₦31,000 more than the
 * screen said.
 */
export function getShippingQuote(country: string, state: string): Promise<ShippingQuote> {
  const q = new URLSearchParams({ country: country || "NG", state: state || "" });
  return request<ShippingQuote>(`/shipping/quote?${q.toString()}`);
}

/** The studio-collection option. Hide the choice entirely when not enabled. */
export function getPickupOption(): Promise<PickupOption> {
  return request<PickupOption>("/shipping/pickup");
}

/* ------------------------------------------------------------------ *
 * Coupons
 * ------------------------------------------------------------------ */

export interface CouponPreview {
  ok: true;
  code: string;
  type: "percent" | "fixed" | "free_shipping";
  discount: number;
  shipping_discount: number;
  /** Ready-made, e.g. "20% OFF" / "₦5,000 OFF" / "FREE SHIPPING". */
  label: string;
}

/**
 * Preview a discount code.
 *
 * Explicitly non-binding: it is evaluated against a subtotal WE send, so it can
 * only ever be optimistic, and the order recomputes the discount from its own
 * priced cart. A preview can succeed and the order still fail on the same code
 * (single-use raced, limit reached) — treat the 201's figures as the truth.
 *
 * The saving to show the shopper is `discount + shipping_discount`.
 */
export function previewCoupon(
  code: string,
  subtotal: number,
  delivery: number,
): Promise<CouponPreview> {
  return request<CouponPreview>("/coupons/apply", {
    method: "POST",
    auth: true,
    body: { code: code.trim(), subtotal, delivery },
  });
}

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

export interface OrderPayload {
  customer: { first_name: string; last_name: string; email: string; phone: string };
  delivery: {
    address: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    /** "standard" | "express" | "pickup" — free text server-side, priced by name. */
    method: string;
    /** The ONLY accepted tiers. Must be nested here, not at the top level. */
    packaging: "standard" | "premium" | "luxe";
    note?: string;
  };
  lines: {
    product_id: number;
    /** Exactly the string the API gave in `lengths` — an unrecognised one 422s. */
    length?: string;
    colour?: string;
    density?: string;
    /** Option CODE. The server resolves its surcharge from the canonical table. */
    preparation?: string;
    /** Required whenever the option has styles — the API 422s without it. */
    preparation_style?: string;
    qty: number;
  }[];
  payment: { method: PaymentMethodId };
  coupon_code?: string;
}

export interface BankInstructions {
  type: "bank_transfer";
  reference: string;
  amount: number;
  bank: {
    enabled?: boolean;
    bank_name?: string;
    account_name?: string;
    account_number?: string;
  };
}

export interface CryptoInstructions {
  type: "crypto";
  reference: string;
  amount: number;
  crypto: {
    enabled?: boolean;
    usdt_address?: string;
    usdt_network?: string;
    btc_address?: string;
  };
}

export interface OrderResult {
  order_id: string;
  ref: string;
  /** "pending" for everything that still needs money; "paid" for wallet. */
  status: string;
  /** The argument GET /payments/verify takes. Present on every method. */
  tx_ref: string;
  charge_currency: string;
  /** Major units as a string, e.g. "255000.00". */
  charge_amount: string;
  /** Gateway methods only — open this in a browser sheet. */
  payment_url?: string;
  /** Bank transfer and crypto only. These details arrive ONCE. */
  instructions?: BankInstructions | CryptoInstructions;
}

/**
 * Place the order. This is the one authoritative pricing event.
 *
 * The client sends product ids, quantities and option KEYS; the server prices
 * every line from its own tables (per-length price, product discount,
 * preparation surcharge, shipping zone, packaging tier, coupon) and the figures
 * it returns are what the shopper is charged. Anything the app computed is a
 * preview — `lines[].unit_price` and `totals` are not even read.
 *
 * Retrying after a failed gateway attempt is the intended recovery path: the
 * server cancels the shopper's earlier unpaid card attempts in the same
 * transaction and frees any coupon they held. So no client idempotency key is
 * needed — but see the warning on `verifyPayment`: verify BEFORE retrying, or a
 * payment that actually succeeded lands on an order this call just cancelled.
 */
export function createOrder(payload: OrderPayload): Promise<OrderResult> {
  return request<OrderResult>("/orders", { method: "POST", auth: true, body: payload });
}

/* ------------------------------------------------------------------ *
 * Payment verification
 * ------------------------------------------------------------------ */

export interface PaymentStatus {
  ref: string;
  status: string;
  payment_method: string | null;
  /** The ONLY field that may drive a success screen. */
  paid: boolean;
  total: number;
  charge_currency: string;
  charge_amount: string;
  /** Which kind of thing this reference belongs to. Assert on it. */
  kind: "order" | "wallet_topup" | "installment";
}

/**
 * Ask the server whether the money arrived.
 *
 * This is not a status read — it is the verification. For a configured gateway
 * it calls the provider's API with the secret key and only then flips the order
 * to paid, under a row lock and exactly once, so a webhook that beat us simply
 * returns the settled payload.
 *
 * Two rules the screens depend on:
 *   · the browser sheet closing proves NOTHING. It resolves on dismissal
 *     whether the shopper paid, failed or swiped it away. Only `paid` is proof.
 *   · `paid: false` means "not confirmed yet", never "declined". A webhook can
 *     land seconds after the redirect, and bank transfer and crypto stay pending
 *     until a person records receipt.
 *
 * One reference space covers orders, wallet top-ups and instalment payments, so
 * check `kind === "order"` before rendering order copy — the web shipped a bug
 * where a top-up reported itself as a paid order.
 */
export function verifyPayment(txRef: string): Promise<PaymentStatus> {
  return request<PaymentStatus>(`/payments/verify?tx_ref=${encodeURIComponent(txRef)}`);
}

/**
 * Settle a payment locally, with no gateway.
 *
 * Development only, and the server agrees: it 404s unless that gateway has no
 * real key AND the app is local AND FRONTEND_URL is loopback. `approve` runs
 * the same idempotent markPaid a real verification would; `fail` only records
 * an audit event and leaves the order pending.
 *
 * Call the simulator rather than opening its web page: that page lives at
 * FRONTEND_URL, which is http://localhost:3000 here — on a phone that means the
 * phone itself.
 */
export function simulatePayment(
  txRef: string,
  outcome: "approve" | "fail",
): Promise<PaymentStatus> {
  return request<PaymentStatus>("/payments/simulate", {
    method: "POST",
    body: { tx_ref: txRef, outcome },
  });
}
