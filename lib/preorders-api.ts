import { request } from "./http";

/**
 * Pre-orders — reserve a piece from a batch that has not landed yet.
 *
 * Paid from the WALLET only; there is no gateway path, so someone without the
 * balance is sent to top up rather than shown a card form that cannot work.
 *
 * `POST /preorders/{id}/pay` takes a TYPE, never an amount — the server works
 * out the deposit or the balance from its own figures, so a number this screen
 * displayed cannot become what is debited.
 */

export type PreorderStatus = "pending" | "deposit_paid" | "paid" | "fulfilled" | "cancelled";

export interface Preorder {
  id: number;
  ref: string;
  status: PreorderStatus;
  /** Snapshotted at reservation — not a live join, so it survives the product. */
  name: string;
  slug: string | null;
  image: string | null;
  /**
   * Already-formatted display strings (length, colour, density, preparation).
   *
   * `preparation` arrives as a RENDERED label like "Hair wigging · Curled
   * (+₦50,000)", not a code — never parse money back out of it.
   */
  variant: string[];
  note: string | null;
  qty: number;
  unit_price: number;
  total_amount: number;
  deposit_percent: number;
  deposit_amount: number;
  amount_paid: number;
  balance_due: number;
  /** `YYYY-MM-DD` the batch is expected. */
  release_at: string | null;
  created_at: string | null;
}

export async function getPreorders(): Promise<Preorder[]> {
  const res = await request<{ data: Preorder[] }>("/preorders/mine", { auth: true });

  return res.data ?? [];
}

/**
 * Pay the deposit, or settle the rest.
 *
 * The status that comes back is recomputed from money rather than from what
 * was asked for, so read it off the response instead of assuming.
 */
export function payPreorder(
  id: number,
  type: "deposit" | "full",
): Promise<{ preorder: Preorder; wallet_balance: number }> {
  return request(`/preorders/${id}/pay`, {
    method: "POST",
    body: { type },
    auth: true,
  });
}
