import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// `Thumb` is a sized photo well, not account chrome — it carries no card or
// border language of its own, so the checkout can use the same one rather than
// grow a second way of drawing a product thumbnail.
import { Thumb } from "@/components/account-ui";
import { Divider, Notice, SectionCard, SummaryRow } from "@/components/checkout-ui";
import { CheckoutShell } from "@/components/checkout-shell";
import { IconDocument } from "@/components/icons";
import { GradientButton, Overline, Txt } from "@/components/ui";
import { findMyOrderByRef, type Order } from "@/lib/account-api";
import { useCart } from "@/lib/cart";
import { useCheckout } from "@/lib/checkout";
import {
  CheckoutError,
  simulatePayment,
  verifyPayment,
  type BankInstructions,
  type CryptoInstructions,
  type PaymentStatus,
} from "@/lib/checkout-api";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { openOrderReceipt } from "@/lib/receipt";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * Checkout, step 3 — did the money arrive?
 *
 * This screen exists because the old checkout did not have one. It opened the
 * hosted page, took the sheet closing as success, showed "ORDER PLACED" and
 * emptied the bag — for a declined card, a swiped-away sheet and a completed
 * payment alike.
 *
 * The only source of truth is GET /payments/verify, which actually calls the
 * gateway with the shop's secret key. Three rules follow from that:
 *
 *   · `paid: false` means "not confirmed yet", never "declined". A
 *     signature-verified webhook can land seconds after the redirect, and bank
 *     transfer and crypto stay pending until a person records receipt. So we
 *     re-check on a backing-off schedule before saying anything final.
 *   · the bag is cleared ONLY on `paid`, so an abandoned attempt leaves the
 *     shopper's cart intact and they can retry without rebuilding it.
 *   · one reference space covers orders, wallet top-ups and instalments, so
 *     `kind` is asserted before any order copy is rendered.
 *
 * MONEY ON THIS SCREEN IS ₦, NOT THE DISPLAY CURRENCY. Everything here is a
 * record of what was charged, and `useApproxMoney()` is for figures that are
 * merely read. Where the gateway took another currency the order carries that
 * amount too, and both are shown — the ₦ the books are in, and the figure the
 * card statement will show.
 */

/** Backing off rather than hammering: /payments/verify allows 30 a minute. */
const RETRY_MS = [2000, 3000, 5000, 10_000];

export default function ConfirmStep() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { pending, setPending, reset, ready } = useCheckout();
  const params = useLocalSearchParams<{ tx?: string }>();

  /**
   * The reference, latched the first time we see one.
   *
   * Deriving it every render from `pending` was a bug with teeth: the paid
   * branch calls setPending(null), so on the very next render the reference
   * vanished and the `!txRef` guard below — which sits above the success
   * render — told a shopper whose money had just been taken that there was
   * "nothing to confirm". Latching also survives the draft hydrating a tick
   * late, which otherwise flashed the same screen.
   */
  const latched = useRef<string | null>(null);
  if (latched.current === null) {
    const candidate = params.tx ?? (ready ? (pending?.txRef ?? null) : null);
    if (candidate) latched.current = candidate;
  }
  const txRef = latched.current;

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleared = useRef(false);
  const alive = useRef(true);

  const manualMethod =
    status?.payment_method === "bank_transfer" || status?.payment_method === "crypto";

  const check = useCallback(
    async (ref: string) => {
      setChecking(true);
      setError(null);
      try {
        const res = await verifyPayment(ref);
        if (!alive.current) return;
        setStatus(res);

        // Assert the reference is OURS before touching anything. The checks
        // below empty the bag and destroy the pending record, and one
        // reference space covers orders, wallet top-ups and instalments — so a
        // stale or crafted link to a paid top-up would have wiped a real
        // order's only recoverable reference and then rendered "that's a
        // different payment". The render-time guard was too late.
        if (res.kind !== "order") {
          setSettled(true);
          setChecking(false);
          return;
        }

        if (res.paid) {
          // The one place the bag is emptied, and only once however many polls
          // land on it.
          if (!cleared.current) {
            cleared.current = true;
            cart.clear();
            reset();
            setPending(null);
          }
          setSettled(true);
          setChecking(false);
          return;
        }

        // Bank transfer and crypto are supposed to sit pending — a person
        // records receipt. Polling them is pointless and would just burn the
        // rate limit.
        if (res.payment_method === "bank_transfer" || res.payment_method === "crypto") {
          setSettled(true);
          setChecking(false);
          return;
        }

        const wait = RETRY_MS[attempt.current];
        if (wait === undefined) {
          setSettled(true);
          setChecking(false);
          return;
        }
        attempt.current += 1;
        timer.current = setTimeout(() => void check(ref), wait);
      } catch (err) {
        if (!alive.current) return;
        setChecking(false);
        setSettled(true);
        setError(
          err instanceof CheckoutError
            ? err.status === 404
              ? "We couldn’t find that payment. If money has left your account, contact us with your order reference and we’ll trace it."
              : err.message
            : "We couldn’t check your payment just now.",
        );
      }
    },
    [cart, reset, setPending],
  );

  useEffect(() => {
    alive.current = true;
    if (txRef) void check(txRef);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // check() is stable for a given reference; re-running on cart identity
    // would restart the poll every time the bag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRef]);

  function again() {
    if (!txRef) return;
    attempt.current = 0;
    setSettled(false);
    void check(txRef);
  }

  /* ---------------- nothing to check ---------------- */

  if (!txRef) {
    return (
      <Result
        title="Nothing to confirm"
        body="We don’t have a payment to check. If you were part-way through an order, your bag is still here."
        primary={{ label: "Back to my bag", onPress: () => router.replace("/cart") }}
      />
    );
  }

  /* ---------------- wrong kind of reference ---------------- */

  if (status && status.kind !== "order") {
    return (
      <Result
        title="That’s a different payment"
        body={
          status.kind === "wallet_topup"
            ? "This reference belongs to a wallet top-up, not an order."
            : "This reference belongs to an instalment plan, not an order."
        }
        primary={{ label: "Back to shop", onPress: () => router.replace("/") }}
      />
    );
  }

  /* ---------------- still checking ---------------- */

  // `checking`, not `checking && !status`. Once the first poll answered, the
  // old guard fell through to the "we haven't seen this payment / no money has
  // been taken" copy for the whole remaining ~20s of the retry ladder — which
  // is exactly the declined-vs-not-yet-settled confusion this screen exists to
  // prevent, and a card paid by transfer or USSD settles inside that window.
  if (checking) {
    return (
      <CheckoutShell title="Payment" footerSpace={40}>
        <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 28 }}>
          <ActivityIndicator color={theme.colors.primary} />
          <Txt tone="ink" display size={22} center style={{ marginTop: 20 }}>
            Confirming your payment
          </Txt>
          <Txt tone="faint" size={13} center style={{ marginTop: 10, lineHeight: 19 }}>
            This takes a moment. Your bag is untouched until it clears.
          </Txt>
        </View>
      </CheckoutShell>
    );
  }

  const paid = Boolean(status?.paid);
  const ref = status?.ref ?? pending?.orderRef ?? "";
  /**
   * The amount, in Naira.
   *
   * `naira()` and not `money()`: this is a record of a charge, not a price
   * being browsed, so it must match the books and the gateway rather than the
   * shopper's chosen display currency. The foreign figure, when there is one,
   * is shown BESIDE it rather than instead of it.
   */
  const amount = status ? naira(status.total) : pending ? naira(pending.total) : "";
  const charged =
    status && status.charge_currency && status.charge_currency !== "NGN"
      ? `${status.charge_currency} ${status.charge_amount}`
      : null;

  /* ---------------- paid ---------------- */

  if (paid) {
    return <PaidConfirmation orderRef={ref} amount={amount} charged={charged} bottomInset={insets.bottom} />;
  }

  /* ---------------- bank transfer / crypto ---------------- */

  if (manualMethod) {
    return (
      <ManualInstructions
        ref_={ref}
        amount={amount}
        instructions={pending?.instructions as BankInstructions | CryptoInstructions | undefined}
        bottomInset={insets.bottom}
      />
    );
  }

  /* ---------------- not confirmed ---------------- */

  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 24 }}>
        <Overline>PAYMENT NOT CONFIRMED YET</Overline>
        <Txt tone="strong" display size={24} style={{ marginTop: 12 }}>
          We haven’t seen this payment
        </Txt>
        <Txt tone="body" size={13} style={{ marginTop: 12, lineHeight: 20 }}>
          No money has been taken for an attempt that did not go through, and your bag is
          untouched. If you did pay, it can take a moment to reach us — check again below.
        </Txt>

        {error ? (
          <View style={{ marginTop: 16 }}>
            <Notice tone="danger">{error}</Notice>
          </View>
        ) : null}

        <View style={{ marginTop: 18 }}>
          <SectionCard>
            <SummaryRow label="Order" value={ref || "—"} />
            {amount ? <SummaryRow label="Amount" value={amount} /> : null}
            <Divider />
            <Txt tone="faint" size={11} style={{ lineHeight: 16 }}>
              Quote this reference if you need to contact us about it.
            </Txt>
          </SectionCard>
        </View>

        <GradientButton
          label={checking ? "Checking…" : "Check again"}
          style={{ marginTop: 20 }}
          disabled={checking}
          onPress={again}
        />

        <Pressable
          onPress={() => router.replace("/checkout/payment")}
          accessibilityRole="button"
          style={({ pressed }) => [{ marginTop: 16, alignItems: "center" }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="primary" size={13} weight="medium">
            Try paying this order again
          </Txt>
        </Pressable>

        {/*
          The deliberate way out.

          `paid: false` means "not confirmed yet", never "declined" — a hosted
          page can be paid by transfer or USSD and settle minutes later — so
          the app must NOT release the attempt on its own: the next order would
          supersede a still-live payment and park real money on a cancelled
          order. But without any release the shopper was stuck in a loop, sent
          back here by every later tap on Pay, with no way to order again until
          the record aged out six hours later. So it is offered, with what it
          costs stated, and only they can take it.
        */}
        <Pressable
          onPress={() => {
            setPending(null);
            router.replace("/checkout/payment");
          }}
          accessibilityRole="button"
          accessibilityLabel="Abandon this attempt and start a new order"
          style={({ pressed }) => [{ marginTop: 18, alignItems: "center" }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="faint" size={12} center style={{ lineHeight: 17 }}>
            Abandon this attempt and start a new order. If this one does turn out to be
            paid, contact us with {ref || "the reference above"} and we’ll sort it out.
          </Txt>
        </Pressable>

        {__DEV__ && settled ? <DevSimulator txRef={txRef} onDone={again} /> : null}
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Paid
 * ------------------------------------------------------------------ */

/**
 * What a shopper sees the moment their money clears.
 *
 * It used to be four lines of centred text and two buttons, which is the one
 * place in the whole app where a customer most wants to see the thing they
 * just bought: what it was, what it cost, what happens now, and something they
 * can keep.
 *
 * Two sources, deliberately:
 *
 *   · the headline, the reference and the amount come from the VERIFICATION,
 *     which has already answered. They render immediately — a confirmation
 *     must never wait on a second request to tell someone their payment went
 *     through.
 *   · everything below comes from the ORDER ROW, fetched after. It is the
 *     authoritative copy (the bag has just been emptied, and what the client
 *     priced is not what the server charged), so it is worth the wait, and a
 *     failure to load it costs the detail and not the confirmation.
 */
function PaidConfirmation({
  orderRef,
  amount,
  charged,
  bottomInset,
}: {
  orderRef: string;
  amount: string;
  /** e.g. "USD 428.66" when the gateway took another currency. Null for ₦. */
  charged: string | null;
  bottomInset: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeS);

  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderRef) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const found = await findMyOrderByRef(orderRef);
      setOrder(found);
      if (!found) {
        // Paid, verified, and not in their list: the only sane reading is a
        // lag we cannot see, so it says so rather than implying the order is
        // missing.
        setLoadError("Your payment is confirmed. The full details are still catching up — pull up your orders in a moment.");
      }
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "We couldn’t load the details of this order.",
      );
    } finally {
      setLoading(false);
    }
  }, [orderRef]);

  useEffect(() => {
    void load();
  }, [load]);

  async function getReceipt() {
    if (!order) return;
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      await openOrderReceipt(order.id);
    } catch (err) {
      setReceiptError(
        err instanceof ApiError ? err.message : "We couldn’t open your receipt just now.",
      );
    } finally {
      setReceiptBusy(false);
    }
  }

  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 10 }}>
        {/* ---- the confirmation itself ---- */}
        <View style={{ alignItems: "center", paddingTop: 14 }}>
          {/* Decorative: the overline and the headline already say this in
              words, and a screen reader announcing a tick glyph adds nothing. */}
          <View style={styles.crest} importantForAccessibility="no-hide-descendants" accessible={false}>
            <Text style={styles.crestMark}>✓</Text>
          </View>
          <Overline>PAYMENT CONFIRMED</Overline>
          <Txt tone="strong" display size={26} center style={{ marginTop: 10 }}>
            Thank you — you’re all set
          </Txt>
          <Txt tone="body" size={13} center style={{ marginTop: 10, lineHeight: 20 }}>
            We have your payment and your order is with our studio.
          </Txt>
        </View>

        {/* ---- what was paid ----
            The reference is selectable because it is the one string a customer
            is ever asked to quote back to us. */}
        <View style={{ marginTop: 20 }}>
          <SectionCard>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>ORDER</Text>
                <Txt tone="ink" size={15} weight="medium" selectable style={{ marginTop: 4 }}>
                  {orderRef || "—"}
                </Txt>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.microLabel}>PAID</Text>
                <Txt tone="ink" display size={22} style={{ marginTop: 2 }}>
                  {amount}
                </Txt>
                {charged ? (
                  <Txt tone="faint" size={11} style={{ marginTop: 2 }}>
                    Charged {charged}
                  </Txt>
                ) : null}
              </View>
            </View>
            {order?.payment_method ? (
              <>
                <Divider />
                <Txt tone="faint" size={11} style={{ lineHeight: 16 }}>
                  Paid by {methodLabel(order.payment_method)}.
                </Txt>
              </>
            ) : null}
          </SectionCard>
        </View>

        {/* ---- the order itself ---- */}
        {loading ? (
          <View style={{ alignItems: "center", paddingVertical: 28 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Txt tone="faint" size={11} style={{ marginTop: 10 }}>
              Loading your order…
            </Txt>
          </View>
        ) : loadError ? (
          <View style={{ marginTop: 16 }}>
            <Notice tone="info">{loadError}</Notice>
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              style={({ pressed }) => [{ marginTop: 14, alignItems: "center" }, pressed && { opacity: 0.7 }]}
            >
              <Txt tone="primary" size={13} weight="medium">
                Try again
              </Txt>
            </Pressable>
          </View>
        ) : order ? (
          <>
            <View style={{ marginTop: 16 }}>
              <SectionCard>
                <Text style={styles.microLabel}>WHAT YOU BOUGHT</Text>
                <View style={{ marginTop: 12, gap: 14 }}>
                  {order.items.map((i) => (
                    <View key={i.id} style={{ flexDirection: "row", gap: 12 }}>
                      <Thumb
                        src={i.image}
                        seed={i.slug ?? String(i.id)}
                        alt={i.name}
                        width={50}
                        height={58}
                      />
                      <View style={{ flex: 1 }}>
                        <Txt tone="strong" size={12} weight="medium" style={{ lineHeight: 17 }}>
                          {i.name}
                        </Txt>
                        {[i.length, i.colour, i.density].filter(Boolean).length ? (
                          <Txt tone="body" size={10} style={{ marginTop: 3 }}>
                            {[i.length, i.colour, i.density].filter(Boolean).join(" · ")}
                          </Txt>
                        ) : null}
                        {i.preparation ? (
                          <Txt tone="body" size={10} style={{ marginTop: 2 }}>
                            {[i.preparation, i.preparation_style].filter(Boolean).join(" · ")}
                          </Txt>
                        ) : null}
                        <View style={{ flexDirection: "row", marginTop: 6, alignItems: "center" }}>
                          <Txt tone="faint" size={10} style={{ flex: 1 }}>
                            Qty {i.qty}
                          </Txt>
                          <Txt tone="ink" size={12} weight="medium">
                            {naira(i.line_total)}
                          </Txt>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>

                <Divider />

                <SummaryRow label="Subtotal" value={naira(order.totals.subtotal)} />
                <SummaryRow
                  label="Delivery & packaging"
                  value={order.totals.delivery === 0 ? "Free" : naira(order.totals.delivery)}
                  tone={order.totals.delivery === 0 ? "success" : "body"}
                />
                {order.totals.discount > 0 ? (
                  <SummaryRow
                    label={order.coupon_code ? `Discount (${order.coupon_code})` : "Discount"}
                    value={`−${naira(order.totals.discount)}`}
                    tone="success"
                  />
                ) : null}
                <Divider />
                <SummaryRow label="Total paid" value={naira(order.totals.total)} strong />
              </SectionCard>
            </View>

            {/* ---- where it is going ---- */}
            <View style={{ marginTop: 12 }}>
              <SectionCard>
                <Text style={styles.microLabel}>DELIVERING TO</Text>
                <Txt tone="strong" size={12} weight="medium" style={{ marginTop: 8 }}>
                  {order.customer.name}
                </Txt>
                <Txt tone="body" size={11} style={{ marginTop: 4, lineHeight: 17 }}>
                  {[
                    order.delivery.address,
                    order.delivery.city,
                    order.delivery.state,
                    order.delivery.zip,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Txt>
              </SectionCard>
            </View>

            {/* ---- what happens now ----
                The question every customer asks next, answered before they
                have to go looking. The wigging lead time is the shop's own
                promise on the product page and belongs here too, where it
                changes what someone expects this week. */}
            <View style={{ marginTop: 12 }}>
              <SectionCard>
                <Text style={styles.microLabel}>WHAT HAPPENS NEXT</Text>
                <View style={{ marginTop: 12, gap: 14 }}>
                  <NextStep
                    n={1}
                    title="We prepare your pieces"
                    body="Each unit is checked and packed by hand. Wigging and styling add 2–3 working days."
                  />
                  <NextStep
                    n={2}
                    title="We send the dispatch details"
                    body="The courier or waybill and its tracking number appear on this order as soon as it leaves us."
                  />
                  <NextStep
                    n={3}
                    title="Your traceable codes travel with it"
                    body="Every unit carries its own code with full ownership history — it is what lets you resell it on Thrift later."
                  />
                </View>
              </SectionCard>
            </View>

            {/* ---- the receipt ---- */}
            {receiptError ? (
              <View style={{ marginTop: 16 }}>
                <Notice tone="danger">{receiptError}</Notice>
              </View>
            ) : null}

            <GradientButton
              label={receiptBusy ? "Opening…" : "View / print receipt"}
              icon={<IconDocument width={18} height={18} color="#FFFFFF" />}
              style={{ marginTop: 20 }}
              disabled={receiptBusy}
              onPress={() => void getReceipt()}
            />
            {/* Says exactly what the tap does. The receipt is a printable page,
                not a PDF file this app generates, and promising otherwise is a
                promise the customer discovers broken. */}
            <Txt tone="faint" size={11} center style={{ marginTop: 10, lineHeight: 16 }}>
              Opens in your browser — use its Print option to save a PDF copy.
            </Txt>
          </>
        ) : null}

        <Pressable
          onPress={() => router.replace("/profile")}
          accessibilityRole="button"
          style={({ pressed }) => [{ marginTop: 22, alignItems: "center" }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="primary" size={13} weight="medium">
            View my orders
          </Txt>
        </Pressable>

        <Pressable
          onPress={() => router.replace("/")}
          accessibilityRole="button"
          style={({ pressed }) => [
            { marginTop: 14, marginBottom: bottomInset + 10, alignItems: "center" },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Txt tone="faint" size={12} weight="medium">
            Back to shop
          </Txt>
        </Pressable>
      </View>
    </CheckoutShell>
  );
}

/** One numbered line in "what happens next". */
function NextStep({ n, title, body }: { n: number; title: string; body: string }) {
  const styles = useThemedStyles(makeS);

  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={styles.stepDot}>
        <Text style={styles.stepNum}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Txt tone="strong" size={12} weight="medium">
          {title}
        </Txt>
        <Txt tone="body" size={10.5} style={{ marginTop: 3, lineHeight: 16 }}>
          {body}
        </Txt>
      </View>
    </View>
  );
}

/** The stored method id, in words a customer recognises. */
function methodLabel(method: string): string {
  if (method === "flutterwave") return "card (Flutterwave)";
  if (method === "paystack") return "card (Paystack)";
  if (method === "bank_transfer") return "bank transfer";
  if (method === "crypto") return "crypto transfer";
  if (method === "wallet") return "store credit";

  return method.replace(/_/g, " ");
}

/* ------------------------------------------------------------------ *
 * Bank transfer / crypto
 * ------------------------------------------------------------------ */

function ManualInstructions({
  ref_,
  amount,
  instructions,
  bottomInset,
}: {
  ref_: string;
  amount: string;
  instructions?: BankInstructions | CryptoInstructions;
  bottomInset: number;
}) {
  const bank = instructions?.type === "bank_transfer" ? instructions.bank : null;
  const crypto = instructions?.type === "crypto" ? instructions.crypto : null;

  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 24 }}>
        <Overline>ORDER PLACED</Overline>
        <Txt tone="strong" display size={24} style={{ marginTop: 12 }}>
          Send your payment
        </Txt>
        <Txt tone="body" size={13} style={{ marginTop: 12, lineHeight: 20 }}>
          Your pieces are reserved. We’ll confirm your order as soon as the payment lands —
          please quote the reference below so we can match it.
        </Txt>

        <View style={{ marginTop: 18 }}>
          <SectionCard>
            <SummaryRow label="Order" value={ref_ || "—"} />
            {amount ? <SummaryRow label="Amount" value={amount} strong /> : null}
            <Divider />
            <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4 }}>
              REFERENCE
            </Txt>
            <Txt tone="ink" size={14} weight="medium" selectable style={{ marginTop: 4 }}>
              {instructions?.reference ?? ref_}
            </Txt>
          </SectionCard>
        </View>

        {bank ? (
          <View style={{ marginTop: 12 }}>
            <SectionCard>
              <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4, marginBottom: 8 }}>
                BANK DETAILS
              </Txt>
              {bank.bank_name ? <SummaryRow label="Bank" value={bank.bank_name} /> : null}
              {bank.account_name ? <SummaryRow label="Account name" value={bank.account_name} /> : null}
              {bank.account_number ? (
                <View style={{ marginTop: 8 }}>
                  <Txt tone="faint" size={11}>
                    Account number
                  </Txt>
                  <Txt tone="ink" display size={20} selectable style={{ marginTop: 2 }}>
                    {bank.account_number}
                  </Txt>
                </View>
              ) : null}
            </SectionCard>
          </View>
        ) : null}

        {crypto ? (
          <View style={{ marginTop: 12 }}>
            <SectionCard>
              <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4, marginBottom: 8 }}>
                WALLET ADDRESSES
              </Txt>
              {crypto.usdt_address ? (
                <View style={{ marginBottom: 10 }}>
                  <Txt tone="faint" size={11}>
                    USDT{crypto.usdt_network ? ` · ${crypto.usdt_network}` : ""}
                  </Txt>
                  <Txt tone="ink" size={12.5} selectable style={{ marginTop: 3, lineHeight: 18 }}>
                    {crypto.usdt_address}
                  </Txt>
                </View>
              ) : null}
              {crypto.btc_address ? (
                <View>
                  <Txt tone="faint" size={11}>
                    Bitcoin
                  </Txt>
                  <Txt tone="ink" size={12.5} selectable style={{ marginTop: 3, lineHeight: 18 }}>
                    {crypto.btc_address}
                  </Txt>
                </View>
              ) : null}
            </SectionCard>
          </View>
        ) : null}

        {!instructions ? (
          <View style={{ marginTop: 12 }}>
            <Notice tone="info">
              We don’t have the payment details on this device any more. Contact us with the
              order reference above and we’ll send them again.
            </Notice>
          </View>
        ) : null}

        <GradientButton
          label="Back to shop"
          style={{ marginTop: 20, marginBottom: bottomInset + 10 }}
          onPress={() => router.replace("/")}
        />
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Result scaffold
 * ------------------------------------------------------------------ */

/** The dead ends: a reference we have nothing to do with. One way out each. */
function Result({
  title,
  body,
  primary,
}: {
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
}) {
  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ alignItems: "center", paddingTop: 40, paddingHorizontal: 28 }}>
        <Txt tone="strong" display size={25} center>
          {title}
        </Txt>
        <Txt tone="body" size={13} center style={{ marginTop: 12, lineHeight: 20 }}>
          {body}
        </Txt>
        <GradientButton
          label={primary.label}
          style={{ marginTop: 28, alignSelf: "stretch" }}
          onPress={primary.onPress}
        />
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Development only
 * ------------------------------------------------------------------ */

/**
 * Settle a test payment without a gateway.
 *
 * `__DEV__`-gated here and gated again on the server, which 404s the endpoint
 * unless that gateway has no real key AND the app is local AND FRONTEND_URL is
 * loopback. Note this calls the API directly rather than opening the
 * simulator's web page: that page lives at FRONTEND_URL — http://localhost:3000
 * — which on a phone means the phone itself.
 */
function DevSimulator({ txRef, onDone }: { txRef: string; onDone: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(outcome: "approve" | "fail") {
    setBusy(true);
    setNote(null);
    try {
      await simulatePayment(txRef, outcome);
      onDone();
    } catch (err) {
      setNote(
        err instanceof CheckoutError && err.status === 404
          ? "Simulator off for this gateway — it needs a gateway with no key, APP_ENV=local and a loopback FRONTEND_URL. Run `php artisan payments:check`."
          : err instanceof CheckoutError
            ? err.message
            : "Simulation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: 28, opacity: 0.9 }}>
      <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4 }}>
        DEVELOPMENT ONLY
      </Txt>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <Pressable
          onPress={() => void run("approve")}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [devBtn(theme), pressed && { opacity: 0.7 }]}
        >
          <Txt tone="success" size={12} weight="medium">
            Simulate approve
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => void run("fail")}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [devBtn(theme), pressed && { opacity: 0.7 }]}
        >
          <Txt tone="danger" size={12} weight="medium">
            Simulate fail
          </Txt>
        </Pressable>
      </View>
      {note ? (
        <Txt tone="faint" size={11} style={{ marginTop: 8, lineHeight: 16 }}>
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

const devBtn = (t: Theme) => ({
  flex: 1,
  height: 40,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: t.surfaces.lineCheckout,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});

const makeS = (t: Theme) => StyleSheet.create({
  /**
   * The success mark.
   *
   * A tinted well rather than a filled purple disc: the screen already has one
   * purple fill (the receipt button) and two compete for the eye. The tick
   * carries the shop's success green, which is the same green the order
   * timeline marks a completed step with.
   */
  crest: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.colors.successBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  crestMark: {
    fontFamily: fonts.medium,
    fontSize: 24,
    color: t.colors.success,
    includeFontPadding: false,
  },

  /** The checkout's own small caps label — not the gold storefront Overline. */
  microLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: t.textInk.faint,
    includeFontPadding: false,
  },

  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: {
    fontFamily: fonts.medium,
    fontSize: 11,
    // READ purple, so it has to be primaryOn — `primary` on this tint is a
    // contrast failure in dark.
    color: t.colors.primaryOn,
    includeFontPadding: false,
  },
});
