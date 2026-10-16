import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "./auth";
import { displayPrice } from "./product-variant";
import type { Product } from "./types";

/**
 * Saved pieces.
 *
 * Device-local, exactly as on the website — there is no wishlist endpoint, so
 * this is the whole feature rather than a cache of one. It therefore does not
 * follow the customer to another device, which the screen says plainly instead
 * of implying a sync that does not exist.
 *
 * Scoped to the account. A wishlist is a record of what somebody was shopping
 * for, and keyed by feature name alone it was handed to whoever signed in next
 * on the same device — the leak the website already fixed. An entry with no
 * owner, or another owner, is dropped rather than shown: one lost wishlist
 * beats one leaked one.
 */

/**
 * The pre-2026-10-15 key: ONE entry holding `{owner, value}` for whoever saved
 * last. Still read, once, so an existing list survives the upgrade — never
 * written, and never deleted, because another account on this device may still
 * need to claim its own from it.
 */
const LEGACY_KEY = "osygentle.wishlist.v1";

/** One key PER ACCOUNT, so neither can overwrite or delete the other's. */
const keyFor = (owner: string) => `osygentle.wishlist.v2.${owner}`;

/** Enough of a product to render the list without re-fetching it. */
export interface WishItem {
  id: number;
  slug: string;
  name: string;
  spec: string;
  /** The price of the variant the product page opens on, as the grid shows it. */
  price: number;
  image?: string | null;
  addedAt: string;
}

interface Owned {
  owner: string;
  value: WishItem[];
}

interface WishlistValue {
  items: WishItem[];
  /** False until storage has been read — screens avoid flashing "empty". */
  ready: boolean;
  has: (id: number) => boolean;
  toggle: (product: Product) => void;
  remove: (id: number) => void;
  clear: () => void;
}

const WishlistContext = createContext<WishlistValue | null>(null);

const ownerId = (userId?: number | null) => (userId == null ? "guest" : String(userId));

export function WishlistProvider({ children }: { children: ReactNode }) {
  // `loading` is load-bearing, not decoration.
  //
  // On launch the auth provider reads the stored session asynchronously, so
  // for the first few frames `user` is null and this provider used to compute
  // owner = "guest". It then read the saved list, saw it belonged to someone
  // else, and DELETED IT — before auth had even finished telling it who was
  // signed in. Every launch wiped a signed-in shopper's saved pieces, and the
  // damage was permanent.
  const { user, loading: authLoading } = useAuth();
  const owner = ownerId(user?.id);

  const [items, setItems] = useState<WishItem[]>([]);
  const [ready, setReady] = useState(false);

  // Guards the first render from writing an empty list over a stored one.
  const hydrated = useRef(false);

  useEffect(() => {
    // Until auth has spoken we do not know whose list this is, so we touch
    // nothing at all.
    if (authLoading) return;

    let cancelled = false;
    hydrated.current = false;
    setReady(false);

    (async () => {
      let next: WishItem[] = [];

      // Each account gets its OWN key, so one account can never overwrite or
      // delete another's list. The old design kept every account in one key
      // and deleted it whenever the owner did not match — which is what made
      // the guest-first race destructive rather than merely wrong.
      const mine = await AsyncStorage.getItem(keyFor(owner)).catch(() => null);

      if (mine) {
        try {
          const parsed = JSON.parse(mine) as WishItem[];
          if (Array.isArray(parsed)) next = parsed;
        } catch {
          /* unreadable — start clean */
        }
      } else {
        // Nothing under the new key: adopt the legacy single-key list, but
        // ONLY if it was this owner's. It is left in place rather than moved,
        // so another account on this device can still claim its own.
        const legacy = await AsyncStorage.getItem(LEGACY_KEY).catch(() => null);
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy) as Partial<Owned>;
            if (parsed?.owner === owner && Array.isArray(parsed.value)) {
              next = parsed.value;
              await AsyncStorage.setItem(keyFor(owner), JSON.stringify(next)).catch(() => {});
            }
          } catch {
            /* unreadable — start clean */
          }
        }
      }

      if (cancelled) return;

      setItems(next);
      hydrated.current = true;
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, authLoading]);

  useEffect(() => {
    if (!hydrated.current) return;
    void AsyncStorage.setItem(keyFor(owner), JSON.stringify(items)).catch(() => {});
  }, [items, owner]);

  const has = useCallback((id: number) => items.some((i) => i.id === id), [items]);

  const toggle = useCallback((product: Product) => {
    setItems((list) => {
      if (list.some((i) => i.id === product.id)) {
        return list.filter((i) => i.id !== product.id);
      }

      const item: WishItem = {
        id: product.id,
        slug: product.slug,
        name: product.name,
        spec: product.spec ?? "",
        // The same figure the grid advertises, so the saved price cannot read
        // differently from the card it was saved from.
        price: displayPrice(product),
        image: product.image ?? null,
        addedAt: new Date().toISOString(),
      };

      return [item, ...list];
    });
  }, []);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<WishlistValue>(
    () => ({ items, ready, has, toggle, remove, clear }),
    [items, ready, has, toggle, remove, clear],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used inside WishlistProvider");
  return ctx;
}
