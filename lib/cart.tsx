import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { netPriceForLength } from "./product-variant";
import type { CartLine, Product } from "./types";

/**
 * The bag — React context persisted with AsyncStorage, per the brief.
 *
 * A configured variant (product + length + colour) is its own line; adding the
 * same configuration again bumps the quantity rather than duplicating the row.
 *
 * Prices here are for DISPLAY. `POST /orders` re-prices server-side, so a
 * stale bag can never buy anything at the wrong price.
 */

const STORAGE_KEY = "osygentle.cart.v1";

export function lineKey(
  line: Pick<CartLine, "product" | "length" | "colour" | "preparation" | "preparationStyle">,
): string {
  // Preparation is part of the variant: the same wig prepared two ways is two
  // lines, at two prices.
  return [
    line.product.id,
    line.length ?? "",
    line.colour ?? "",
    line.preparation ?? "",
    line.preparationStyle ?? "",
  ].join("|");
}

interface CartValue {
  lines: CartLine[];
  count: number;
  subtotal: number;
  /** False until the stored bag has been read — screens avoid flashing "empty". */
  ready: boolean;
  add: (
    product: Product,
    opts?: {
      length?: string;
      colour?: string;
      qty?: number;
      preparation?: string;
      preparationTitle?: string;
      preparationStyle?: string;
      preparationStyleLabel?: string;
      surcharge?: number;
    },
  ) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  // Guards the first render pass from writing an empty bag over a stored one.
  const hydrated = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw) as CartLine[];
        if (Array.isArray(parsed)) setLines(parsed);
      })
      .catch(() => {
        /* first run or unreadable — an empty bag is the right fallback */
      })
      .finally(() => {
        if (!alive) return;
        hydrated.current = true;
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lines)).catch(() => {});
  }, [lines]);

  const value = useMemo<CartValue>(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    // Preparation is charged per unit, like the piece itself.
    // Priced per CHOSEN LENGTH, which is what the server charges. The figure
    // is derived from the product object the line already carries rather than
    // snapshotted onto the line, so bags persisted before this change price
    // correctly too instead of rendering ₦NaN.
    const subtotal = lines.reduce(
      (n, l) => n + (netPriceForLength(l.product, l.length) + (l.surcharge ?? 0)) * l.qty,
      0,
    );

    return {
      lines,
      count,
      subtotal,
      ready,

      add: (product, opts = {}) => {
        const next: CartLine = {
          product,
          length: opts.length,
          colour: opts.colour,
          qty: opts.qty ?? 1,
          preparation: opts.preparation,
          preparationTitle: opts.preparationTitle,
          preparationStyle: opts.preparationStyle,
          preparationStyleLabel: opts.preparationStyleLabel,
          surcharge: opts.surcharge,
        };
        const key = lineKey(next);
        setLines((prev) => {
          const existing = prev.find((l) => lineKey(l) === key);
          if (existing) {
            return prev.map((l) =>
              lineKey(l) === key ? { ...l, qty: l.qty + next.qty } : l,
            );
          }
          return [...prev, next];
        });
      },

      setQty: (key, qty) =>
        setLines((prev) =>
          qty <= 0
            ? prev.filter((l) => lineKey(l) !== key)
            : prev.map((l) => (lineKey(l) === key ? { ...l, qty } : l)),
        ),

      remove: (key) => setLines((prev) => prev.filter((l) => lineKey(l) !== key)),

      clear: () => setLines([]),
    };
  }, [lines, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
