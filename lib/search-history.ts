import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "./auth";
import { request } from "./http";

/**
 * Recent shop searches, kept on the phone — the list is never sent to the
 * server and never leaves the device. The website keeps the same list in
 * localStorage; this is the same feature with the same surface
 * (read/push/remove/clear/log), not a cache of a server list that does not
 * exist.
 *
 * SCOPED TO THE ACCOUNT, deliberately. A search history is a record of what
 * somebody was shopping for — "closure for thinning edges", "wig for my
 * mother's funeral" — and this app has already shipped one cross-account leak
 * of exactly that shape (the wishlist and the chat, keyed by feature name
 * alone, were handed to whoever signed in next on the same phone). So the key
 * carries the owner, each account gets its own, and nobody can read, overwrite
 * or delete anybody else's.
 *
 * Everything read back is re-sanitised rather than trusted: device storage is
 * writable by anything else in the app and survives upgrades, so a corrupted
 * or hand-edited value must never reach the UI as-is. Entries are trimmed,
 * length-capped, de-duplicated case-insensitively and count-capped on both
 * read and write.
 */

const MAX_ENTRIES = 8;
/**
 * Matches the search field's own cap. A shorter limit here silently mangles a
 * typed sentence, so replaying it from the recent list would run a DIFFERENT
 * search from the one it claims to repeat.
 */
const MAX_LENGTH = 100;

/** The bucket for nobody in particular — browsing before signing in. */
const GUEST = "guest";

/** One key PER ACCOUNT. Same scheme as the wishlist's `keyFor`. */
const keyFor = (owner: string) => `osygentle.search.history.v1.${owner}`;

/** Who a stored list belongs to. Mirrors the wishlist's `ownerId`. */
export const searchOwnerId = (userId?: number | null): string =>
  userId == null ? GUEST : String(userId);

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const term = raw.trim().slice(0, MAX_LENGTH);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_ENTRIES) break;
  }

  return out;
}

/** Most-recent-first. Never throws — an unreadable list is an empty one. */
export async function readSearchHistory(owner: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(owner));

    return sanitize(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}

async function write(owner: string, list: string[]): Promise<string[]> {
  const next = sanitize(list);
  try {
    await AsyncStorage.setItem(keyFor(owner), JSON.stringify(next));
  } catch {
    /* storage full or unavailable — history is a nicety, never fatal */
  }

  return next;
}

/** Record a term as the most recent search. Returns the new list. */
export async function pushSearchHistory(owner: string, term: string): Promise<string[]> {
  const clean = term.trim().slice(0, MAX_LENGTH);
  if (!clean) return readSearchHistory(owner);
  const rest = (await readSearchHistory(owner)).filter(
    (t) => t.toLowerCase() !== clean.toLowerCase(),
  );

  return write(owner, [clean, ...rest]);
}

/** Forget one term. Returns the new list. */
export async function removeSearchHistory(owner: string, term: string): Promise<string[]> {
  const list = await readSearchHistory(owner);

  return write(
    owner,
    list.filter((t) => t.toLowerCase() !== term.toLowerCase()),
  );
}

/** Forget everything this owner searched for. Returns the (empty) new list. */
export async function clearSearchHistory(owner: string): Promise<string[]> {
  try {
    await AsyncStorage.removeItem(keyFor(owner));
  } catch {
    /* best effort — the empty list below is what the screen will show */
  }

  return [];
}

/**
 * Also record the search on the server, for shop analytics.
 *
 * The consent split is the website's, and it lives in one place so it cannot
 * be forgotten: the search is ALWAYS reported (the shop needs to know what it
 * is being asked for, above all what it could NOT answer), and `attribute`
 * alone decides whether the row is tied to a person.
 *
 * THE APP ALWAYS SENDS `attribute: false`, and sends no bearer token with it.
 * On the website that flag carries the shopper's cookie choice; this app has
 * never asked that question, so it has no consent to carry, and an app that
 * attributes by default would be logging personal searches against a named
 * account on the strength of nothing. Anonymous is the honest default, and it
 * costs the shopper only personalised recommendations. When the app grows a
 * privacy setting this is the one line that changes.
 *
 * Failure is silent: analytics must never break shopping.
 */
export function logSearch(
  term: string,
  results: number,
  filters?: Record<string, string[]>,
): void {
  const q = term.trim().slice(0, 120);
  if (!q) return;

  // Deliberately NOT awaited and NOT `auth`/`authOptional`: no Authorization
  // header means the server could not attribute this row even if the flag
  // were wrong.
  void request("/search-log", {
    method: "POST",
    body: { query: q, results, filters, attribute: false, channel: "app" },
  }).catch(() => {
    /* never let analytics break a search */
  });
}

export interface SearchHistoryValue {
  /** Most-recent-first. */
  history: string[];
  /** False until storage has been read — avoids flashing an empty list. */
  ready: boolean;
  push: (term: string) => void;
  remove: (term: string) => void;
  clearAll: () => void;
}

/**
 * The only thing screens should use.
 *
 * The owner is read from auth HERE rather than passed in by each caller,
 * because "remember to scope it to the account" is exactly the instruction
 * that gets forgotten on the fourth screen.
 */
export function useSearchHistory(): SearchHistoryValue {
  // `loading` is load-bearing. On launch the auth provider reads the stored
  // session asynchronously, so for the first few frames `user` is null and
  // the owner would compute as "guest" — which is how the wishlist once came
  // to delete a signed-in shopper's saved pieces on every launch. Until auth
  // has spoken, this touches nothing at all.
  const { user, loading: authLoading } = useAuth();
  const owner = searchOwnerId(user?.id);

  const [history, setHistory] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  /** The owner we last acted on, so a sign-out is recognisable as a change. */
  const seenOwner = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    setReady(false);

    (async () => {
      const previous = seenOwner.current;
      seenOwner.current = owner;

      // Signing out hands the phone back to "whoever picks it up next", and
      // the guest bucket is the one bucket they share. So a sign-out empties
      // it: the searches made while signed OUT do not greet the next person
      // either. The per-account keys already stop one member reading
      // another's; this closes the signed-out seam the website leaves open.
      if (owner === GUEST && previous !== null && previous !== GUEST) {
        await clearSearchHistory(GUEST);
      }

      const list = await readSearchHistory(owner);
      if (cancelled) return;

      setHistory(list);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, authLoading]);

  const push = useCallback(
    (term: string) => {
      void pushSearchHistory(owner, term).then(setHistory);
    },
    [owner],
  );

  const remove = useCallback(
    (term: string) => {
      void removeSearchHistory(owner, term).then(setHistory);
    },
    [owner],
  );

  const clearAll = useCallback(() => {
    void clearSearchHistory(owner).then(setHistory);
  }, [owner]);

  return { history, ready, push, remove, clearAll };
}
