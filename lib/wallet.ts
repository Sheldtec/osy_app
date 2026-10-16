import { API_BASE, apiHeaders } from "./api";
import { authToken } from "./auth";
import { request } from "./http";
import type { Wallet } from "./types";

/**
 * Store credit.
 *
 * GET /api/wallet is an AUTHENTICATED route — there is no mock fallback and
 * there should not be one. A balance is money: showing an invented figure to a
 * signed-out visitor, or when the API is unreachable, is the one thing this
 * screen must never do. Callers get null and say so.
 */
const TIMEOUT_MS = 10_000;

export async function getWallet(): Promise<Wallet | null> {
  const token = authToken();
  if (!API_BASE || !token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/wallet`, {
      headers: apiHeaders({ Authorization: `Bearer ${token}` }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Wallet;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claim the welcome credit.
 *
 * The server decides eligibility and guards against a double claim, so this
 * only asks. Returns the new balance, or throws with the server's reason.
 */
export async function claimWelcomeCredit(): Promise<{ amount: number }> {
  const token = authToken();
  if (!API_BASE || !token) throw new Error("Sign in to claim your credit.");

  const res = await fetch(`${API_BASE}/wallet/welcome/claim`, {
    method: "POST",
    headers: apiHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; amount?: number };
  if (!res.ok) throw new Error(body.message ?? "The credit could not be claimed.");
  return { amount: body.amount ?? 0 };
}

// ---------------------------------------------------------------------------
// Topping up
// ---------------------------------------------------------------------------

/** What the server will accept. `bank_transfer` is manual and settles later. */
export type TopupMethod = "flutterwave" | "paystack" | "bank_transfer";

/** The server's own bounds on a single top-up, mirrored for the form. */
export const TOPUP_MIN = 1_000;
export const TOPUP_MAX = 2_000_000;

export interface BankInstructions {
  type: "bank_transfer";
  /** The unguessable reference the customer MUST quote. */
  reference: string;
  amount: number;
  /**
   * Our account details.
   *
   * This is the shop's raw payment-settings block, so it carries an `enabled`
   * BOOLEAN alongside the strings. Anything rendering it must pick the fields
   * it means rather than iterating the object, or the customer is shown a
   * detail row reading "ENABLED — true".
   */
  bank: {
    enabled?: boolean;
    bank_name?: string | null;
    account_name?: string | null;
    account_number?: string | null;
  };
}

export interface TopupStarted {
  ref: string;
  /** Hosted checkout. Present for the gateway methods only. */
  payment_url?: string;
  /** Manual transfer. Present for bank_transfer only. */
  instructions?: BankInstructions;
}

/**
 * Start a top-up.
 *
 * This creates a PENDING row and nothing more — it never moves money. A
 * gateway top-up is credited only once the server has verified it
 * (`verifyTopup`), and a bank transfer only once a human confirms the money
 * arrived. The app must never add to a balance itself.
 */
export function startTopup(amount: number, method: TopupMethod): Promise<TopupStarted> {
  return request<TopupStarted>("/wallet/topup", {
    method: "POST",
    body: { amount: Math.round(amount), method },
    auth: true,
  });
}

/**
 * The reference `GET /payments/verify` needs, pulled out of the checkout link.
 *
 * The top-up response returns `ref` (WT-XXXXXX) but NOT `payment_ref`, and
 * verify only resolves the LATTER — passing the WT- ref gets a flat 404
 * "Unknown payment reference", so a top-up started from the app would never
 * settle. The only place the payment_ref appears for a gateway top-up is the
 * `tx_ref` query parameter of `payment_url`.
 *
 * (For a bank transfer it is `instructions.reference` instead.)
 *
 * Parsed with a regex rather than `new URL()`: React Native's URL is a partial
 * implementation and its query handling is not something to rely on.
 */
export function txRefFromPaymentUrl(paymentUrl: string): string | null {
  const m = /[?&]tx_ref=([^&#]+)/.exec(paymentUrl);

  return m ? decodeURIComponent(m[1]) : null;
}

export interface TopupStatus {
  ref: string;
  status: string;
  payment_method: string;
  /** The ONLY field that means the money is in. */
  paid: boolean;
  total: number;
  kind: string;
}

/**
 * Ask the server whether a top-up actually completed.
 *
 * `GET /payments/verify` is the single source of truth; it re-checks with the
 * provider and settles the credit server-side. `paid: false` means "not seen
 * yet", NOT "declined" — a webhook can still land seconds later, and a bank
 * transfer stays unpaid until a person confirms it.
 *
 * The `kind` guard matters: the same endpoint resolves orders and instalment
 * payments too, and a reference collision must not be read as a top-up.
 */
export async function verifyTopup(txRef: string): Promise<TopupStatus> {
  const res = await request<TopupStatus>(
    `/payments/verify?tx_ref=${encodeURIComponent(txRef)}`,
    { authOptional: true, timeoutMs: 30_000 },
  );

  if (res.kind !== "wallet_topup") {
    throw new Error("That reference is not a wallet top-up.");
  }

  return res;
}

/** Abandon a pending bank transfer the customer has decided not to send. */
export function cancelTopup(id: number): Promise<unknown> {
  return request(`/wallet/topups/${id}/cancel`, { method: "POST", auth: true });
}

// ---------------------------------------------------------------------------
// Cashing out
// ---------------------------------------------------------------------------

export interface WithdrawalInput {
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/**
 * Request a cash-out.
 *
 * Capped at `wallet.withdrawable` — cleared referral and resale income only,
 * NOT the whole balance, because store credit the shop issued is not cash. The
 * server recomputes that ceiling under a lock, so the figure shown here is a
 * courtesy and never the authority.
 *
 * On success the amount is debited immediately as a HOLD; a human pays it out,
 * and a rejection refunds it.
 */
export function requestWithdrawal(input: WithdrawalInput): Promise<unknown> {
  return request("/wallet/withdrawals", {
    method: "POST",
    body: {
      amount: Math.round(input.amount),
      bank_name: input.bankName.trim(),
      account_number: input.accountNumber.trim(),
      account_name: input.accountName.trim(),
    },
    auth: true,
  });
}

/** Withdraw a request that has not been paid yet; the hold is refunded. */
export function cancelWithdrawal(id: number): Promise<unknown> {
  return request(`/wallet/withdrawals/${id}/cancel`, { method: "POST", auth: true });
}

