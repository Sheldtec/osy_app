import AsyncStorage from "@react-native-async-storage/async-storage";

import { request } from "./http";
import type { CurrencyCode } from "./currency";

/**
 * The storefront concierge — POST /concierge.
 *
 * The server proxies the conversation to Claude with a brand-locked prompt and
 * a live catalogue snapshot, and falls back to a scripted knowledge base when
 * there is no API key or the day's budget is spent. Either way the shape of
 * the reply is the same, and `source` says which answered.
 *
 * The bearer token is attached WHEN THERE IS ONE and the call works fine
 * without it: signed in, the concierge can look up your own orders; signed
 * out, it answers everything else. So this must not be an `auth: true` call —
 * that would refuse to ask the question at all for a guest.
 *
 * `/concierge/stream` exists and the website uses it, but it is Server-Sent
 * Events. React Native's `fetch` has no readable response stream, so consuming
 * it would mean an EventSource polyfill and a second code path for no visible
 * gain on a phone-sized reply. This takes the plain JSON endpoint.
 */

/** The server's own limits, mirrored (`ConciergeController`). */
export const MAX_TURNS = 24;
export const MAX_CHARS = 2000;

export interface ConciergeTurn {
  role: "user" | "assistant";
  content: string;
}

/** A product the concierge recommended, priced by the server. */
export interface ConciergeProduct {
  slug: string;
  name: string;
  spec: string | null;
  price: number;
  sale_price: number;
  discount_percent: number;
  image: string | null;
}

export interface ConciergeReply {
  reply: string;
  products: ConciergeProduct[];
  /** The concierge thinks a person should take this over. */
  handoff: boolean;
  source: "assistant" | "scripted";
}

/**
 * A concierge reply waits on an LLM call made inside the request.
 *
 * The 12s default would abandon perfectly good answers. The server's own
 * budget for the upstream call is the real ceiling; this sits above it.
 */
const REPLY_TIMEOUT_MS = 60_000;

/**
 * Ask the concierge a question.
 *
 * `currency` is the shopper's DISPLAY currency, and only a code goes over the
 * wire — never a rate and never a converted amount. The server resolves the
 * rate itself from the same service that prices a foreign-currency charge at
 * checkout, and writes its prose in that currency with a leading "≈". Omit it
 * and the reply is in Naira, which is what the shop actually charges either
 * way. `Recommended()` keeps formatting the product cards client-side with
 * `useApproxMoney()`; this only governs the sentences.
 */
export async function askConcierge(
  messages: ConciergeTurn[],
  currency?: CurrencyCode,
): Promise<ConciergeReply> {
  // Only the most recent turns are sent. The server caps the array at
  // MAX_TURNS and 422s above it, and the cap has to be applied from the END —
  // trimming the newest messages would send the shopper's question without
  // the question.
  const trimmed = messages.slice(-MAX_TURNS).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_CHARS),
  }));

  return request<ConciergeReply>("/concierge", {
    method: "POST",
    body: { messages: trimmed, currency: currency ?? "NGN" },
    authOptional: true,
    timeoutMs: REPLY_TIMEOUT_MS,
  });
}

// ---------------------------------------------------------------------------
// Transcript persistence
// ---------------------------------------------------------------------------

/**
 * The saved chat is scoped to whoever was signed in when it was written.
 *
 * Follows `lib/wishlist.tsx`: an `{owner, value}` envelope, and a mismatch is
 * DROPPED rather than shown. A concierge thread can contain order references
 * and delivery addresses, so handing the last person's conversation to the
 * next person to open the app on a shared phone is a real disclosure, not an
 * untidy bit of state.
 */
const KEY = "osygentle.concierge.v1";

interface Owned<T> {
  owner: string;
  value: T;
}

const ownerId = (userId?: number | null) => (userId == null ? "guest" : String(userId));

export interface StoredTurn extends ConciergeTurn {
  id: string;
  products?: ConciergeProduct[];
  handoff?: boolean;
}

export async function loadTranscript(userId?: number | null): Promise<StoredTurn[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Owned<StoredTurn[]> | null;
    if (parsed?.owner !== ownerId(userId) || !Array.isArray(parsed.value)) {
      // Not ours. Clear it so it cannot be read again.
      await AsyncStorage.removeItem(KEY).catch(() => {});

      return [];
    }

    return parsed.value;
  } catch {
    return [];
  }
}

export async function saveTranscript(turns: StoredTurn[], userId?: number | null): Promise<void> {
  const payload: Owned<StoredTurn[]> = { owner: ownerId(userId), value: turns.slice(-MAX_TURNS) };
  await AsyncStorage.setItem(KEY, JSON.stringify(payload)).catch(() => {});
}

export async function clearTranscript(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
