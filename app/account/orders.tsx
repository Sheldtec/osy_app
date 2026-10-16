import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AccountShell,
  Empty,
  Failed,
  FilterChips,
  Loading,
  Panel,
  Pill,
  SearchField,
  SortControl,
  Thumb,
} from "@/components/account-ui";
import { IconCalendar, IconUnits } from "@/components/icons";
import { Txt } from "@/components/ui";
import { getMyOrders, ORDER_BUCKETS, type Order, type OrderStatus } from "@/lib/account-api";
import { ApiError } from "@/lib/http";
import { naira } from "@/lib/format";
import { useApproxMoney } from "@/lib/currency-context";
import { useTheme } from "@/theme/theme-context";

/**
 * My orders.
 *
 * The profile tab has advertised four order tiles since launch — To pay,
 * Processing, Shipped, Review — all hard-coded to zero, with a "View all" that
 * did nothing. This is the screen behind them.
 */

const STATUS: Record<OrderStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  pending: { label: "To pay", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  processing: { label: "Processing", tone: "mute" },
  shipped: { label: "Shipped", tone: "mute" },
  delivered: { label: "Delivered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
  refunded: { label: "Refunded", tone: "bad" },
};

/**
 * How the list can be ordered.
 *
 * Date first because it is what the list already means — the server returns
 * newest first and that is the default. Amount is the other axis people
 * actually scan for ("what was that big one?"), and both directions are
 * offered because "my cheapest order" is as real a question as "my dearest".
 */
const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "highest", label: "Highest amount" },
  { key: "lowest", label: "Lowest amount" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  // The profile tab's four tiles deep-link here with their own bucket, so
  // tapping "Shipped" opens the shipped orders rather than the whole list.
  const { status } = useLocalSearchParams<{ status?: string }>();
  const [bucket, setBucket] = useState<string>(status ?? "all");
  const [sort, setSort] = useState<SortKey>("newest");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      setOrders(await getMyOrders());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your orders.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Filtered on the device, not the server.
   *
   * GET /orders/mine already returns the whole history (the server caps it at
   * 100), so every order is in hand — a search endpoint would add a round trip
   * and a rate limit to something that can be instant. It also keeps working
   * with no signal, which an order history someone is checking in a shop
   * doorway needs.
   */
  /** Counts are of the WHOLE history, so a chip says how many exist, not how
   *  many survive the current search — a count that moved as you typed would
   *  be unreadable. */
  const chips = useMemo(() => {
    const all = orders ?? [];

    return [
      { key: "all", label: "All", count: all.length },
      ...ORDER_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        count: all.filter(b.match).length,
      })),
      // A bucket nobody has any orders in is a dead control. All stays
      // whatever happens, so there is never an empty row.
    ].filter((c) => c.key === "all" || c.count > 0);
  }, [orders]);

  // A bucket can empty out after a refresh (the last pending order gets paid),
  // which would otherwise leave the list filtered by a chip that is no longer
  // on screen.
  useEffect(() => {
    if (orders && !chips.some((c) => c.key === bucket)) setBucket("all");
  }, [orders, chips, bucket]);

  const matches = useMemo(() => {
    const all = orders ?? [];
    const picked = ORDER_BUCKETS.find((b) => b.key === bucket);
    const inBucket = picked ? all.filter(picked.match) : all;

    const q = query.trim().toLowerCase();
    if (!q) return inBucket;

    return inBucket.filter((o) => {
      const haystack = [
        o.ref,
        STATUS[o.status]?.label ?? o.status,
        o.payment_method ?? "",
        placed(o),
        ...o.items.flatMap((i) => [i.name, i.length ?? "", i.colour ?? "", ...i.codes]),
      ]
        .join(" ")
        .toLowerCase();

      // Every word must appear somewhere, so "bob paid" narrows rather than
      // widens — the opposite of matching any single term.
      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }, [orders, query, bucket]);

  /**
   * Sorted after filtering, on a copy — `matches` is memoised from `orders`,
   * and sorting in place would mutate the array the other memo handed back.
   *
   * An order with no `placed_at` sorts last in both directions rather than
   * being treated as the epoch, which would park it at one end as if it were
   * the oldest thing the customer ever bought.
   */
  const shown = useMemo(() => {
    const list = [...matches];
    const at = (o: Order) => {
      const t = o.timeline.placed_at ? Date.parse(o.timeline.placed_at) : NaN;
      return Number.isNaN(t) ? null : t;
    };

    return list.sort((a, b) => {
      if (sort === "highest") return b.totals.total - a.totals.total;
      if (sort === "lowest") return a.totals.total - b.totals.total;

      const ta = at(a);
      const tb = at(b);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;

      return sort === "oldest" ? ta - tb : tb - ta;
    });
  }, [matches, sort]);

  const searching = query.trim().length > 0;
  const filtered = bucket !== "all";
  const total = orders?.length ?? 0;
  const bucketLabel = ORDER_BUCKETS.find((b) => b.key === bucket)?.label ?? "";

  return (
    <AccountShell
      title="My orders"
      subtitle={
        total
          ? searching || filtered
            ? `${matches.length} of ${total} order${total === 1 ? "" : "s"}`
            : `${total} order${total === 1 ? "" : "s"}, ${(
                SORTS.find((o) => o.key === sort)?.label ?? ""
              ).toLowerCase()}`
          : "Every order you’ve placed, with its traceable code."
      }
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
    >
      {total > 0 ? (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search by piece, reference or code"
            label="Search my orders"
          />
          <FilterChips
            options={chips}
            value={bucket}
            onChange={setBucket}
            label="Filter orders by status"
          />
          <SortControl
            options={SORTS.map((o) => ({ key: o.key, label: o.label }))}
            value={sort}
            onChange={(k) => setSort(k as SortKey)}
            bottomInset={insets.bottom}
          />
        </>
      ) : null}

      {orders === null && error === null ? <Loading label="Loading your orders…" /> : null}

      {error && orders === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {orders?.length === 0 ? (
        <Empty
          title="No orders yet"
          body="When you place an order it appears here, with its traceable code and delivery updates."
          action={{ label: "Start shopping", onPress: () => router.replace("/shop") }}
        />
      ) : null}

      {/* Nothing matched is a different state from having no orders, and needs
          a different way out: clear the search, not go shopping.

          Only a SEARCH can empty the list — a status with no orders has no
          chip to select, and the effect above drops a selection that stops
          existing. So there is no "no orders in this status" case to write. */}
      {total > 0 && searching && matches.length === 0 ? (
        <Empty
          title="Nothing matched"
          body={
            filtered
              ? `No ${bucketLabel.toLowerCase()} order mentions “${query.trim()}”. Try another status, or search the whole list.`
              : `No order mentions “${query.trim()}”. Try a piece name, an order reference like LX-, or a unit code like LXU-.`
          }
          action={{ label: "Clear search", onPress: () => setQuery("") }}
        />
      ) : null}

      {shown.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}
    </AccountShell>
  );
}

function OrderCard({ order }: { order: Order }) {
  const theme = useTheme();
  // A settled historical total — safe to read in the chosen currency.
  const money = useApproxMoney();
  const s = STATUS[order.status] ?? { label: order.status, tone: "mute" as const };
  const first = order.items[0];
  const more = order.items.length - 1;
  const units = order.items.reduce((n, i) => n + i.qty, 0);
  const date = placed(order);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.ref}, ${date}, ${units} ${
        units === 1 ? "item" : "items"
      }, ${s.label}, ${money(order.totals.total)}`}
      onPress={() => router.push({ pathname: "/account/order/[id]", params: { id: String(order.id) } })}
      style={({ pressed }) => [pressed && { opacity: 0.8 }]}
    >
      <Panel>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Txt tone="strong" weight="medium" size={11} style={{ flex: 1 }}>
            {order.ref}
          </Txt>
          <Pill label={s.label} tone={s.tone} />
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Thumb src={first?.image} seed={first?.slug ?? order.ref} alt={first?.name ?? "Order"} />
          <View style={{ flex: 1 }}>
            <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 16 }}>
              {first?.name ?? "Order"}
            </Txt>

            {more > 0 ? (
              <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                + {more} more {more === 1 ? "piece" : "pieces"}
              </Txt>
            ) : null}

            <Txt tone="strong" display size={17} style={{ marginTop: 8 }}>
              {money(order.totals.total)}
            </Txt>

            {/* Under the amount, because that is where the eye already is once
                it has read the piece — and the two facts people scan an order
                list for after the piece itself are when it was placed and how
                much of it there was. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 7 }}>
              <View style={metaItem}>
                <IconCalendar width={12} height={12} color={theme.textInk.body} />
                <Txt tone="body" size={9}>
                  {date}
                </Txt>
              </View>
              <View style={metaItem}>
                <IconUnits width={12} height={12} color={theme.textInk.body} />
                <Txt tone="body" size={9}>
                  {units} {units === 1 ? "item" : "items"}
                </Txt>
              </View>
            </View>
          </View>
        </View>

        {/* A superseded attempt is not something the customer did wrong. */}
        {order.superseded_by ? (
          <Txt tone="body" size={9} style={{ marginTop: 12, lineHeight: 14 }}>
            Replaced by a newer attempt ({order.superseded_by}).
          </Txt>
        ) : null}
      </Panel>
    </Pressable>
  );
}

/**
 * When the order was placed.
 *
 * `placed_at` is the only date every order has — `paid_at` is null on anything
 * unpaid, which is exactly the orders someone is most likely to be looking
 * for. The year is dropped for this year's orders, because repeating it on
 * every row is noise; it stays on older ones, where it is the point.
 */
function placed(order: Order): string {
  const raw = order.timeline.placed_at;
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";

  const thisYear = d.getFullYear() === new Date().getFullYear();

  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

/** Icon and its figure, kept together so the pair never wraps apart. */
const metaItem = { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 };
