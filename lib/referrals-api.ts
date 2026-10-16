import { request } from "./http";

/**
 * Referrals — `GET /api/referrals`, and that is the whole member surface.
 *
 * There is NO write endpoint. A referral is attached at signup (the friend
 * types your code) and the reward is paid server-side when their first
 * qualifying order is paid. So this screen reports; it never claims, retries
 * or calculates.
 *
 * One side effect worth knowing: the first call MINTS AND PERSISTS the
 * caller's code if they don't have one. It is a read that writes, so it must
 * not sit inside a tight retry loop.
 */

export type ReferralStatus = "pending" | "rewarded" | "void";

export interface ReferralRow {
  /** First name only — the API never discloses a friend's email. */
  name: string | null;
  status: ReferralStatus;
  /**
   * The amount actually paid, snapshotted when it was.
   *
   * 0 while pending. NOT a prediction — `reward_amount` below is the CURRENT
   * setting and the shop can change it before a pending invite qualifies.
   */
  reward: number;
  at: string | null;
  qualified_at: string | null;
}

export interface Referrals {
  /** False when the shop has paused the programme. The payload still arrives. */
  enabled: boolean;
  /** 8 uppercase characters. Always present. */
  code: string;
  /** What an invite pays TODAY. Not what a pending one will pay. */
  reward_amount: number;
  /** What the invited friend gets. 0 means nothing. */
  referee_amount: number;
  /** Their first order must reach this before anything is paid. */
  min_order: number;
  stats: {
    invited: number;
    pending: number;
    rewarded: number;
    /**
     * Earned, straight from the wallet ledger.
     *
     * This is a SUM of every `referral` credit, so it also includes a bonus
     * received as somebody else's invitee. It is NOT rewarded × reward_amount
     * — never recompute it.
     */
    earned: number;
  };
  /** Newest first, capped at 50 — `stats.invited` can legitimately exceed it. */
  referrals: ReferralRow[];
}

export function getReferrals(): Promise<Referrals> {
  return request<Referrals>("/referrals", { auth: true });
}
