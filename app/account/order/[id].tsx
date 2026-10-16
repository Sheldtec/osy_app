import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AccountShell,
  Divide,
  Failed,
  Line,
  Loading,
  Panel,
  Pill,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { Notice } from "@/components/checkout-ui";
import { OrderPieceSheet } from "@/components/order-piece-sheet";
import { GradientButton, Txt } from "@/components/ui";
import { cancelOrder, getOrder, type Order, type OrderItem, type OrderStatus } from "@/lib/account-api";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/theme-context";

/**
 * One order, in full.
 *
 * The traceable codes live here, which is the point of the whole product: a
 * customer who cannot read back the code on the unit they were sent cannot use
 * the resale market or the ownership history the shop sells on.
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

const STEPS: { key: keyof Order["timeline"]; label: string }[] = [
  { key: "placed_at", label: "Placed" },
  { key: "paid_at", label: "Paid" },
  { key: "shipped_at", label: "Shipped" },
  { key: "delivered_at", label: "Delivered" },
];

export default function OrderDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const numericId = Number(id);

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The piece whose sheet is open. */
  const [piece, setPiece] = useState<OrderItem | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(numericId)) {
      setError("That order reference isn’t one we recognise.");
      return;
    }
    try {
      setOrder(await getOrder(numericId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load this order.");
    } finally {
      setRefreshing(false);
    }
  }, [numericId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      setOrder(await cancelOrder(numericId));
      setConfirming(false);
    } catch (err) {
      // The server refuses once any money has arrived, and says why. That
      // sentence is better than anything this screen could invent.
      setCancelError(err instanceof ApiError ? err.message : "This order could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  if (error && !order) {
    return (
      <AccountShell title="Order">
        <Failed message={error} onRetry={() => void load()} />
      </AccountShell>
    );
  }

  if (!order) {
    return (
      <AccountShell title="Order">
        <Loading label="Loading this order…" />
      </AccountShell>
    );
  }

  const s = STATUS[order.status] ?? { label: order.status, tone: "mute" as const };
  const canCancel =
    order.status === "pending" && !order.timeline.paid_at && order.amount_received === 0;

  return (
    <AccountShell
      title={order.ref}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      <>
        {/* ---- status + timeline ---- */}
        <Panel>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
            <Txt tone="body" size={10} style={{ flex: 1 }}>
              {order.payment_method ? `Paid by ${label(order.payment_method)}` : "Order"}
            </Txt>
            <Pill label={s.label} tone={s.tone} />
          </View>

          {STEPS.map((step, i) => {
            const at = order.timeline[step.key];
            const done = Boolean(at);
            return (
              <View key={step.key} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ alignItems: "center", width: 18 }}>
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: done ? theme.colors.success : theme.surfaces.lineProduct,
                    }}
                  />
                  {i < STEPS.length - 1 ? (
                    <View
                      style={{
                        width: 1,
                        height: 22,
                        backgroundColor: done ? theme.colors.success : theme.surfaces.lineProduct,
                      }}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1, paddingBottom: i < STEPS.length - 1 ? 10 : 0 }}>
                  <Txt tone={done ? "strong" : "body"} size={11} weight={done ? "medium" : "regular"}>
                    {step.label}
                  </Txt>
                  {at ? (
                    <Txt tone="body" size={9} style={{ marginTop: 2 }}>
                      {when(at)}
                    </Txt>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Panel>

        {order.superseded_by ? (
          <Notice tone="info">
            This attempt was replaced by a newer one ({order.superseded_by}). Nothing was charged
            for it.
          </Notice>
        ) : null}

        {/* ---- tracking ---- */}
        {order.delivery.tracking_number ? (
          <Panel>
            <SectionLabel>TRACKING</SectionLabel>
            <Txt tone="strong" size={12} weight="medium" selectable style={{ marginTop: 10 }}>
              {order.delivery.tracking_number}
            </Txt>
            {order.delivery.courier ? (
              <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                {order.delivery.courier}
              </Txt>
            ) : null}
          </Panel>
        ) : null}

        {/* ---- items ---- */}
        <Panel>
          <SectionLabel>{order.items.length === 1 ? "PIECE" : "PIECES"}</SectionLabel>
          <View style={{ marginTop: 12, gap: 14 }}>
            {order.items.map((i) => (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                accessibilityLabel={`${i.name}. Open details`}
                onPress={() => setPiece(i)}
                style={({ pressed }) => [{ flexDirection: "row", gap: 12 }, pressed && { opacity: 0.7 }]}
              >
                <Thumb src={i.image} seed={i.slug ?? String(i.id)} alt={i.name} width={52} height={60} />
                <View style={{ flex: 1 }}>
                  <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 16 }}>
                    {i.name}
                  </Txt>
                  {[i.length, i.colour, i.density].filter(Boolean).length ? (
                    <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                      {[i.length, i.colour, i.density].filter(Boolean).join(" · ")}
                    </Txt>
                  ) : null}
                  {i.preparation ? (
                    <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                      {[i.preparation, i.preparation_style].filter(Boolean).join(" · ")}
                      {i.surcharge > 0 ? ` · +${naira(i.surcharge)}` : ""}
                    </Txt>
                  ) : null}

                  {/* The unit's own code, on the unit. It used to sit in a
                      section of its own with a paragraph explaining what it
                      was for; against the piece it belongs to, it needs no
                      explaining. */}
                  {i.codes.map((c) => (
                    <Txt
                      key={c}
                      tone="strong"
                      size={10}
                      weight="medium"
                      selectable
                      style={{ marginTop: 5, letterSpacing: 0.6 }}
                    >
                      {c}
                    </Txt>
                  ))}
                  <View style={{ flexDirection: "row", marginTop: 6, alignItems: "center" }}>
                    <Txt tone="body" size={9} style={{ flex: 1 }}>
                      Qty {i.qty}
                    </Txt>
                    <Txt tone="strong" size={11} weight="medium">
                      {naira(i.line_total)}
                    </Txt>
                    {/* Without this the row looks like a static summary and
                        nobody discovers it opens. */}
                    <Txt tone="faint" size={14} style={{ marginLeft: 8, marginTop: -2 }}>
                      ›
                    </Txt>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </Panel>

        {/* ---- money ---- */}
        <Panel>
          <SectionLabel>TOTAL</SectionLabel>
          <View style={{ marginTop: 10 }}>
            <Line label="Subtotal" value={naira(order.totals.subtotal)} />
            <Line
              label="Delivery"
              value={order.totals.delivery === 0 ? "Free" : naira(order.totals.delivery)}
              tone={order.totals.delivery === 0 ? "success" : "body"}
            />
            {order.totals.discount > 0 ? (
              <Line
                label={order.coupon_code ? `Discount (${order.coupon_code})` : "Discount"}
                value={`− ${naira(order.totals.discount)}`}
                tone="success"
              />
            ) : null}
            <Divide />
            <Line label="Total" value={naira(order.totals.total)} strong />
            {order.amount_received > 0 && order.amount_received < order.totals.total ? (
              <Line label="Received so far" value={naira(order.amount_received)} />
            ) : null}
          </View>
        </Panel>

        {/* ---- delivery ---- */}
        <Panel>
          <SectionLabel>DELIVERING TO</SectionLabel>
          <Txt tone="strong" size={11} weight="medium" style={{ marginTop: 12 }}>
            {order.customer.name}
          </Txt>
          {order.customer.phone ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              {order.customer.phone}
            </Txt>
          ) : null}
          <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            {[
              order.delivery.address,
              order.delivery.city,
              order.delivery.state,
              order.delivery.zip,
            ]
              .filter(Boolean)
              .join(", ")}
          </Txt>
          {order.delivery.note ? (
            <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 14 }}>
              Note: {order.delivery.note}
            </Txt>
          ) : null}
        </Panel>

        {/* ---- cancel ---- */}
        {canCancel ? (
          <View style={{ marginTop: 2 }}>
            {cancelError ? (
              <View style={{ marginBottom: 12 }}>
                <Notice tone="danger">{cancelError}</Notice>
              </View>
            ) : null}

            {confirming ? (
              <Panel>
                <Txt tone="strong" size={12} weight="medium">
                  Cancel this order?
                </Txt>
                <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
                  The pieces go back on sale and any code you used is released. This cannot be
                  undone.
                </Txt>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setConfirming(false)}
                    accessibilityRole="button"
                    style={({ pressed }) => [keepBtn(theme), pressed && { opacity: 0.7 }]}
                  >
                    <Txt tone="primary" size={13} weight="medium">
                      Keep it
                    </Txt>
                  </Pressable>
                  <GradientButton
                    label={cancelling ? "Cancelling…" : "Yes, cancel"}
                    disabled={cancelling}
                    style={{ flex: 1 }}
                    onPress={() => void doCancel()}
                  />
                </View>
              </Panel>
            ) : (
              <Pressable
                onPress={() => setConfirming(true)}
                accessibilityRole="button"
                accessibilityLabel="Cancel this order"
                style={({ pressed }) => [{ alignItems: "center", paddingVertical: 14 }, pressed && { opacity: 0.7 }]}
              >
                <Txt tone="danger" size={13} weight="medium">
                  Cancel this order
                </Txt>
              </Pressable>
            )}
          </View>
        ) : null}

        {order.status === "pending" && !canCancel ? (
          <Notice tone="info">
            We’ve received part of the payment for this order, so it can’t be cancelled here. Get in
            touch and we’ll sort it out.
          </Notice>
        ) : null}

        <Pressable
          onPress={() => router.replace("/shop")}
          accessibilityRole="button"
          style={({ pressed }) => [{ alignItems: "center", paddingVertical: 10 }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="primary" size={13} weight="medium">
            Continue shopping
          </Txt>
        </Pressable>
      </>

      <OrderPieceSheet
        item={piece}
        open={piece !== null}
        onClose={() => setPiece(null)}
        bottomInset={insets.bottom}
      />
    </AccountShell>
  );
}

const keepBtn = (t: Theme) => ({
  flex: 1,
  height: 54,
  borderRadius: 27,
  borderWidth: 1,
  borderColor: t.surfaces.line,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});

function label(method: string): string {
  if (method === "bank_transfer") return "bank transfer";
  if (method === "wallet") return "wallet credit";
  return method;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
