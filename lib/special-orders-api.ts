import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { API_BASE, apiHeaders } from "./api";
import { authToken } from "./auth-token";
import { ApiError, request } from "./http";

/**
 * Special orders — "find me this piece".
 *
 * A customer describes hair we don't stock, attaches reference photos, and the
 * shop comes back with a quote. That quote is payable from the WALLET or by
 * CARD through either hosted gateway — until recently the wallet was the only
 * route, so anyone quoted more than their store credit could not accept their
 * own quote at all.
 *
 * Nothing in this file ever decides that something has been paid. A card
 * payment is settled by the server after it has verified the transaction with
 * the provider (`verifyQuotePayment`, which calls the same
 * `GET /payments/verify` that settles orders, top-ups and instalments), and the
 * amount is always the server's own `quote_amount` — this app names a method
 * and nothing else.
 */

/**
 * The server's own limits, mirrored.
 *
 * `images` is the strict CUSTOMER tier: JPEG and PNG only, magic-byte checked
 * server-side (`App\Rules\SafeImage`), so a .webp or an .avif renamed to .jpg
 * is refused however the picker labelled it.
 */
export const MAX_IMAGES = 3;
export const MAX_IMAGE_KB = 5120;
export const MIN_DESCRIPTION = 20;

export type SpecialOrderStatus =
  | "pending"
  | "reviewing"
  | "quoted"
  | "accepted"
  | "in_progress"
  | "fulfilled"
  | "declined"
  | "cancelled";

/**
 * Where this quote stands with regard to money, as the SERVER sees it.
 *
 * `payable` is the server's own answer to "will `/pay` work right now", so the
 * screen never has to re-derive it from the lifecycle and get it subtly wrong.
 * `awaiting` is the one state the app cannot infer: a card payment the customer
 * has been sent off to make. The quote is genuinely still unpaid, but for those
 * seconds or minutes "pay it again" is the wrong thing to offer.
 *
 * `check_ref` outlives `awaiting` on purpose. An attempt stops blocking a fresh
 * one after a short window, but a customer whose payment is still unconfirmed
 * an hour later must still be able to ASK about it — asking is free, and paying
 * twice is not.
 */
export interface SpecialOrderPaymentState {
  payable: boolean;
  /** How it was settled, once it has been. */
  method: string | null;
  awaiting: boolean;
  /** An unanswered attempt's reference, to resume verifying rather than re-charge. */
  check_ref: string | null;
}

export interface SpecialOrder {
  id: number;
  ref: string;
  status: SpecialOrderStatus;
  title: string;
  description: string;
  length: string | null;
  colour: string | null;
  budget: number | null;
  /** `YYYY-MM-DD`. */
  needed_by: string | null;
  images: string[];
  /** What the shop quoted. Null until they have. */
  quote_amount: number | null;
  /** Always present; 0 before payment. */
  amount_paid: number;
  paid_at: string | null;
  admin_note: string | null;
  created_at: string | null;
  payment: SpecialOrderPaymentState;
}

export async function getSpecialOrders(): Promise<SpecialOrder[]> {
  const res = await request<{ data: SpecialOrder[] }>("/special-orders/mine", { auth: true });

  return res.data ?? [];
}

/**
 * Cancel a request (refunding anything already paid).
 *
 * `respond` also takes `action: "accept"`, which is the older name for paying
 * from the wallet. This app uses `payQuote` for that instead, so there is one
 * place where a method is chosen.
 */
export function cancelSpecialOrder(
  id: number,
): Promise<{ special_order: SpecialOrder; wallet_balance: number }> {
  return request(`/special-orders/${id}/respond`, {
    method: "POST",
    body: { action: "cancel" },
    auth: true,
  });
}

/** How a quote can be settled. The server gates each one; this list is the ask. */
export type QuotePayMethod = "wallet" | "flutterwave" | "paystack";

export interface QuotePaymentStarted {
  special_order: SpecialOrder;
  /** Wallet only — the balance left afterwards. */
  wallet_balance?: number;
  /** Gateway only — the hosted checkout to open. */
  payment_url?: string;
  /** Gateway only — the reference `verifyQuotePayment` resolves. */
  tx_ref?: string;
  /** True ONLY for a wallet payment, which settles inside the request. */
  paid?: boolean;
  /** The idempotency key was already used: this submit arrived twice. */
  replayed?: boolean;
}

/**
 * Start paying a quote.
 *
 * No amount is ever sent — the charge is the server's own `quote_amount`, read
 * back under a row lock, so a figure this screen showed a minute ago can never
 * become what is debited.
 *
 * A WALLET payment is finished when this resolves. A GATEWAY payment is not:
 * it comes back with `payment_url` and nothing has moved yet, and the quote is
 * paid only once the server verifies the transaction with the provider. Treat a
 * returned link as "go and pay", never as "paid".
 */
export function payQuote(
  id: number,
  method: QuotePayMethod,
  idempotencyKey?: string,
): Promise<QuotePaymentStarted> {
  return request(`/special-orders/${id}/pay`, {
    method: "POST",
    body: { method, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) },
    auth: true,
  });
}

export interface QuotePaymentStatus {
  ref: string | null;
  /** The REQUEST's status — "accepted" once the quote is paid. */
  status: string;
  payment_method: string;
  /** The only field that means the money is in. */
  paid: boolean;
  total: number;
  kind: string;
  /** pending | settled | failed | abandoned | unapplied. */
  attempt_status: string;
  amount_paid: number;
}

/**
 * Ask the server whether a card payment actually completed.
 *
 * `GET /payments/verify` is the single source of truth: it re-checks with the
 * provider using the secret key and settles the quote server-side. `paid: false`
 * means "not seen yet", NOT "declined" — a webhook can still land seconds later.
 *
 * The `kind` guard matters: the same endpoint resolves orders, wallet top-ups
 * and instalment attempts, and another payable's reference must never be read
 * as this one.
 */
export async function verifyQuotePayment(txRef: string): Promise<QuotePaymentStatus> {
  const res = await request<QuotePaymentStatus>(
    `/payments/verify?tx_ref=${encodeURIComponent(txRef)}`,
    { authOptional: true, timeoutMs: 30_000 },
  );

  if (res.kind !== "special_order") {
    throw new ApiError("That reference is not a special-order payment.", 0);
  }

  return res;
}

export interface NewSpecialOrder {
  title: string;
  description: string;
  length?: string;
  colour?: string;
  budget?: number;
  /** `YYYY-MM-DD`, today or later. */
  neededBy?: string;
  /** Local file URIs from the picker, with their pixel size. */
  photos: { uri: string; width: number; height: number }[];
}

/**
 * Shrink a picked photo to something the server will accept.
 *
 * Phone cameras produce 12MP HEIC/JPEG files far over the 5 MB cap, and the
 * server rejects the WHOLE batch if one file fails — so each is re-encoded to
 * JPEG and bounded before it is ever sent. Re-encoding also normalises HEIC,
 * which the picker can hand back on iOS and which the server does not accept.
 *
 * Bounds mirror the server: between 200px and 6000px on each side.
 */
async function prepare(photo: { uri: string; width: number; height: number }): Promise<string> {
  const longEdge = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);

  if (longEdge > 2000) {
    context.resize(photo.width >= photo.height ? { width: 2000 } : { height: 2000 });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });

  return saved.uri;
}

/**
 * Create the request.
 *
 * multipart/form-data, NOT JSON — the endpoint takes real files. `request()`
 * cannot be used here because it sets a JSON content type and stringifies the
 * body; fetch must be left to set its own multipart boundary, which is why the
 * Content-Type header is deliberately absent below.
 */
export async function createSpecialOrder(input: NewSpecialOrder): Promise<SpecialOrder> {
  const token = authToken();
  if (!API_BASE) throw new ApiError("The store is not configured on this device.", 0);
  if (!token) throw new ApiError("Please sign in to continue.", 401);

  const form = new FormData();
  form.append("title", input.title.trim());
  form.append("description", input.description.trim());
  if (input.length?.trim()) form.append("length", input.length.trim());
  if (input.colour?.trim()) form.append("colour", input.colour.trim());
  if (input.budget !== undefined) form.append("budget", String(Math.round(input.budget)));
  if (input.neededBy?.trim()) form.append("needed_by", input.neededBy.trim());

  for (const [i, photo] of input.photos.slice(0, MAX_IMAGES).entries()) {
    const uri = await prepare(photo);
    // React Native's FormData takes this {uri, name, type} shape rather than a
    // Blob; the cast is what every RN upload does.
    form.append("images[]", {
      uri,
      name: `reference-${i + 1}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob);
  }

  const controller = new AbortController();
  // Uploads are slow on a phone connection, and the server then pushes each
  // file to Cloudinary before it answers.
  const timer = setTimeout(() => controller.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/special-orders`, {
      method: "POST",
      // No Content-Type: fetch must set the multipart boundary itself.
      headers: apiHeaders({ Authorization: `Bearer ${token}` }),
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? "That upload took too long. Try again, or use fewer photos."
        : "Could not reach the store. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    errors?: Record<string, string[]>;
    special_order?: SpecialOrder;
  };

  if (!res.ok) {
    throw new ApiError(body.message || "We couldn’t send that request.", res.status, body.errors);
  }

  return body.special_order as SpecialOrder;
}
