import * as Linking from "expo-linking";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChoiceRow,
  Divider,
  Field,
  Notice,
  PayBar,
  SectionCard,
  SummaryRow,
} from "@/components/checkout-ui";
import { CheckoutShell, SignInGate, useCheckoutAuth } from "@/components/checkout-shell";
import { IconCard, IconWalletPay } from "@/components/icons";
import { Overline, Txt } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { useCheckout } from "@/lib/checkout";
import {
  CheckoutError,
  createOrder,
  getPaymentMethods,
  getShippingQuote,
  previewCoupon,
  type CouponPreview,
  type OrderPayload,
  type OrderResult,
  type PaymentMethodId,
  type PaymentMethods,
} from "@/lib/checkout-api";
import { naira } from "@/lib/format";
import { netPriceForLength } from "@/lib/product-variant";
import { getWallet } from "@/lib/wallet";
import { useTheme } from "@/theme/theme-context";
import { layout } from "@/theme/tokens";

/**
 * Checkout, step 2 — how it gets paid for.
 *
 * Three things here are not negotiable, and the old screen got all three wrong.
 *
 * The method ids are the server's: flutterwave, paystack, bank_transfer, crypto,
 * wallet. The old screen's DEFAULT was `card`, which is not one of them, so the
 * happy path 422'd on every live attempt.
 *
 * The rows come from GET /payments/methods, not a hard-coded list. A gateway
 * with no key is refused at order creation, so offering it means the shopper
 * fills in everything before being told.
 *
 * And a browser sheet closing proves nothing — it resolves on dismissal whether
 * the shopper paid, failed, or swiped it away. The old screen treated that as
 * success, cleared the bag and showed a receipt. Here it only ever hands over
 * to the confirm step, which asks the server.
 */

const PACKAGING_FEE: Record<string, number> = { standard: 0, premium: 10_000, luxe: 31_000 };

export default function PaymentStep() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { user, loading: authLoading, signedOut } = useCheckoutAuth();
  const { draft, ready, set, addressComplete, pending, setPending } = useCheckout();

  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [chosen, setChosen] = useState<PaymentMethodId | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);

  const [coupon, setCoupon] = useState(draft.coupon);
  const [couponState, setCouponState] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | undefined>();
  const [couponBusy, setCouponBusy] = useState(false);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A second tap while the first order is in flight would create a second order
  // and silently cancel the first — see the supersede rule in checkout-api.
  const inFlight = useRef(false);

  const packagingFee = PACKAGING_FEE[draft.packaging] ?? 0;
  const discount = couponState ? couponState.discount + couponState.shipping_discount : 0;
  const total = Math.max(0, cart.subtotal + (deliveryFee ?? 0) + packagingFee - discount);

  /* ---------------- loading what the shop can take ---------------- */

  useEffect(() => {
    let cancelled = false;
    getPaymentMethods()
      .then((m) => !cancelled && setMethods(m))
      .catch(() => !cancelled && setMethods(null))
      .finally(() => !cancelled && setMethodsLoading(false));
    getWallet()
      .then((w) => !cancelled && setBalance(w?.balance ?? null))
      .catch(() => !cancelled && setBalance(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !draft.state) return;
    let cancelled = false;
    getShippingQuote("NG", draft.state)
      .then((q) => {
        if (cancelled) return;
        setDeliveryFee(draft.method === "pickup" ? 0 : draft.method === "express" ? q.express_fee : q.fee);
      })
      .catch(() => !cancelled && setDeliveryFee(null));
    return () => {
      cancelled = true;
    };
  }, [ready, draft.state, draft.method]);

  /**
   * Warm the Android Custom Tab so the hosted page does not cold-start.
   *
   * Android only. These two are Custom Tabs APIs with no implementation on
   * web — calling them there throws "not available on web, are you sure you've
   * linked all the native dependencies", which on unmount took the whole
   * screen down.
   */
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const rows = useMemo(() => {
    if (!methods) return [];
    const walletShort = balance !== null && balance < total;
    return [
      {
        id: "flutterwave" as const,
        title: "Card",
        sub: "Visa · Mastercard · Verve, through Flutterwave",
        available: methods.flutterwave.available,
        test: methods.flutterwave.test_mode,
        icon: <IconCard width={20} height={20} color={theme.colors.primaryOn} />,
      },
      {
        id: "paystack" as const,
        title: "Paystack",
        sub: "Card, bank or USSD on Paystack’s page",
        available: methods.paystack.available,
        test: methods.paystack.test_mode,
        icon: <IconCard width={20} height={20} color={theme.colors.primaryOn} />,
      },
      {
        id: "wallet" as const,
        title: "Wallet credit",
        sub:
          balance === null
            ? "Store credit"
            : walletShort
              ? `Balance ${naira(balance)} — ${naira(total - balance)} short`
              : `Balance ${naira(balance)}`,
        available: balance !== null && !walletShort,
        icon: <IconWalletPay width={20} height={20} color={theme.textInk.body} />,
      },
      {
        id: "bank_transfer" as const,
        title: "Bank transfer",
        sub: "We send the account details and your reference",
        available: methods.bank_transfer.available,
        icon: null,
      },
      {
        id: "crypto" as const,
        title: "Crypto",
        sub: "USDT or Bitcoin",
        available: methods.crypto.available,
        icon: null,
      },
    ];
  }, [methods, balance, total]);

  // Pick the first method that actually works, once, rather than defaulting to
  // one the server would refuse.
  useEffect(() => {
    if (chosen || rows.length === 0) return;
    const first = rows.find((r) => r.available);
    if (first) setChosen(first.id);
  }, [rows, chosen]);

  /* ---------------- coupon ---------------- */

  const applyCoupon = useCallback(async () => {
    const code = coupon.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(undefined);
    try {
      const preview = await previewCoupon(code, cart.subtotal, deliveryFee ?? 0);
      setCouponState(preview);
      set({ coupon: code });
    } catch (err) {
      setCouponState(null);
      setCouponError(err instanceof CheckoutError ? err.message : "That code could not be checked.");
    } finally {
      setCouponBusy(false);
    }
  }, [coupon, cart.subtotal, deliveryFee, set]);

  function clearCoupon() {
    setCoupon("");
    setCouponState(null);
    setCouponError(undefined);
    set({ coupon: "" });
  }

  /* ---------------- placing the order ---------------- */

  async function pay() {
    if (inFlight.current || !chosen) return;

    // A payment that may already have succeeded must be settled before another
    // order is created: POST /orders cancels this member's earlier unpaid card
    // attempts, so creating one now would strand a real payment on a cancelled
    // order that needs a human to reconcile.
    if (pending) {
      router.push({ pathname: "/checkout/confirm", params: { tx: pending.txRef } });
      return;
    }

    inFlight.current = true;
    setPlacing(true);
    setError(null);

    const payload: OrderPayload = {
      customer: {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
      },
      delivery: {
        address: draft.address.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        zip: draft.zip.trim(),
        country: "NG",
        method: draft.method,
        packaging: draft.packaging,
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      },
      lines: cart.lines.map((l) => ({
        product_id: l.product.id,
        ...(l.length ? { length: l.length } : {}),
        ...(l.colour ? { colour: l.colour } : {}),
        ...(l.preparation ? { preparation: l.preparation } : {}),
        ...(l.preparationStyle ? { preparation_style: l.preparationStyle } : {}),
        qty: l.qty,
      })),
      payment: { method: chosen },
      // The code the screen SHOWS as applied, in the server's own spelling from
      // the preview — not whatever is sitting in the draft. The draft can hold
      // a code the bag forwarded that was never previewed (charging less than
      // the total on screen, undisclosed), and a code the order 422'd on could
      // never be cleared, so every later tap re-posted it and the account could
      // not place an order from this device at all.
      ...(couponState ? { coupon_code: couponState.code } : {}),
    };

    // Creating the order is the only step whose failure means nothing exists.
    // It gets its own try so that the error mapping below — which discards the
    // pending record — can never run for a failure that happened AFTER the
    // order was created.
    let order: OrderResult;
    try {
      order = await createOrder(payload);
    } catch (err) {
      setPending(null); // nothing was created, so retrying is safe
      inFlight.current = false;
      setPlacing(false);

      if (err instanceof CheckoutError) {
        if (err.unauthenticated) {
          // The draft and the bag survive; send them to sign in and come back.
          setError("Your session expired. Sign in again — your bag and address are saved.");
          router.push("/auth");
        } else if (err.field === "coupon") {
          setCouponState(null);
          setCouponError(err.message);
          setError(null);
        } else {
          setError(err.message);
        }
      } else {
        setError("We could not place your order. Please try again.");
      }
      return;
    }

    // From here the order EXISTS and its stock is already held. The reference
    // must never be discarded again on this path, whatever else fails.
    setPending({
      orderRef: order.ref,
      txRef: order.tx_ref,
      method: chosen,
      total,
      at: Date.now(),
      instructions: order.instructions,
    });

    if (order.payment_url) {
      try {
        // openAuthSessionAsync, not openBrowserAsync: it is the only installed
        // API that closes the sheet on BOTH platforms (dismissBrowser is
        // iOS-only), so the Android Custom Tab is not left in the back stack
        // for the shopper to swipe back into a dead payment page.
        await WebBrowser.openAuthSessionAsync(
          order.payment_url,
          Linking.createURL("checkout/return"),
          { preferEphemeralSession: false, showTitle: true, dismissButtonStyle: "cancel" },
        );
        // Whatever it resolved with — success, cancel, dismiss — the only
        // source of truth is the server.
      } catch {
        // The browser refused to open (a blocked popup, an already-open
        // session, no browser installed). The order still stands, so carry on
        // to the confirm step rather than losing it; that screen can re-open
        // the payment or let the shopper abandon it deliberately.
      }
    }

    inFlight.current = false;
    setPlacing(false);
    router.replace({ pathname: "/checkout/confirm", params: { tx: order.tx_ref } });
  }

  if (authLoading) return <CheckoutShell title="Payment" step={3}>{null}</CheckoutShell>;
  if (signedOut) return <SignInGate />;

  const chosenRow = rows.find((r) => r.id === chosen);
  const payLabel =
    chosen === "wallet"
      ? "Pay from wallet"
      : chosen === "bank_transfer" || chosen === "crypto"
        ? "Get payment details"
        : "Pay securely";

  return (
    <CheckoutShell
      title="Payment"
      step={3}
      banner={error ? <Notice tone="danger">{error}</Notice> : null}
      footer={
        <PayBar
          caption="Total"
          total={total}
          totalNote={
            // An unresolved quote must not read as a complete total. `?? 0`
            // above turns "not known" into "free", and the server will still
            // charge the zone fee — step 1 says so and this step must too.
            deliveryFee === null
              ? "Delivery not included yet"
              : chosenRow?.test
                ? "Test mode — no money moves"
                : undefined
          }
          label={payLabel}
          busy={placing}
          disabled={!chosen || cart.lines.length === 0 || !addressComplete}
          bottomInset={insets.bottom}
          onPress={pay}
        />
      }
    >
      {/* ---- deliver to ---- */}
      <Overline style={ov}>DELIVERING TO</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Txt tone="ink" size={14} weight="medium">
                {`${draft.first_name} ${draft.last_name}`.trim() || "No name yet"}
              </Txt>
              <Txt tone="faint" size={12} style={{ marginTop: 3 }}>
                {draft.phone}
              </Txt>
              <Txt tone="body" size={12.5} style={{ marginTop: 5, lineHeight: 18 }}>
                {[draft.address, draft.city, draft.state, draft.zip].filter(Boolean).join(", ")}
              </Txt>
            </View>
            <Pressable
              onPress={() => router.push("/checkout")}
              accessibilityRole="button"
              accessibilityLabel="Change delivery address"
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
            >
              <Txt tone="primary" size={12.5} weight="medium">
                Change
              </Txt>
            </Pressable>
          </View>
        </SectionCard>
      </View>

      {/* ---- payment method ---- */}
      <Overline style={ov}>PAYMENT METHOD</Overline>
      <View style={{ paddingHorizontal: layout.gutter, gap: 8 }}>
        {methodsLoading ? (
          <View style={{ paddingVertical: 22, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Txt tone="faint" size={12} style={{ marginTop: 10 }}>
              Loading your payment options…
            </Txt>
          </View>
        ) : methods === null ? (
          <Notice tone="danger">
            We couldn’t load the payment options. Check your connection, then tap Retry.
          </Notice>
        ) : (
          rows.map((r) => (
            <ChoiceRow
              key={r.id}
              title={r.title}
              sub={r.available ? r.sub : unavailableReason(r.id, r.sub)}
              selected={chosen === r.id}
              disabled={!r.available}
              badge={r.test ? "TEST MODE" : undefined}
              leading={r.icon}
              onPress={() => setChosen(r.id)}
            />
          ))
        )}

        <Txt tone="faint" size={11} style={{ marginTop: 2, lineHeight: 16 }}>
          We never store your card. Card payments open your bank’s own secure page.
        </Txt>
      </View>

      {/* ---- discount code ---- */}
      <Overline style={ov}>DISCOUNT CODE</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          <Field
            label="Code"
            value={coupon}
            onChangeText={(v) => {
              setCoupon(v.toUpperCase());
              setCouponError(undefined);
            }}
            placeholder="OSY20"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!couponState}
            error={couponError}
            trailing={
              <Pressable
                onPress={couponState ? clearCoupon : applyCoupon}
                disabled={couponBusy || (!couponState && !coupon.trim())}
                accessibilityRole="button"
                accessibilityLabel={couponState ? "Remove discount code" : "Apply discount code"}
                hitSlop={8}
                style={({ pressed }) => [
                  (couponBusy || (!couponState && !coupon.trim())) && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt tone="primary" size={12.5} weight="medium">
                  {couponBusy ? "…" : couponState ? "Remove" : "Apply"}
                </Txt>
              </Pressable>
            }
          />
          {couponState ? (
            <View style={{ marginTop: 10 }}>
              <Notice tone="success">
                {couponState.label} applied — you save {naira(discount)}.
              </Notice>
            </View>
          ) : null}
        </SectionCard>
      </View>

      {/* ---- summary ---- */}
      <Overline style={ov}>ORDER SUMMARY</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          {cart.lines.map((l) => (
            <View key={`${l.product.id}-${l.length ?? ""}-${l.preparation ?? ""}`} style={{ marginBottom: 10 }}>
              <SummaryRow
                label={`${l.product.name}${l.qty > 1 ? ` × ${l.qty}` : ""}`}
                value={naira((netPriceForLength(l.product, l.length) + (l.surcharge ?? 0)) * l.qty)}
              />
              {l.length || l.colour || l.preparationTitle ? (
                <Txt tone="faint" size={11} style={{ marginTop: 1 }}>
                  {[l.length, l.colour, l.preparationTitle].filter(Boolean).join(" · ")}
                </Txt>
              ) : null}
            </View>
          ))}
          <Divider />
          <SummaryRow label="Subtotal" value={naira(cart.subtotal)} />
          <SummaryRow
            label={draft.method === "express" ? "Express delivery" : draft.method === "pickup" ? "Pickup" : "Delivery"}
            value={deliveryFee === null ? "—" : deliveryFee === 0 ? "Free" : naira(deliveryFee)}
            tone={deliveryFee === 0 ? "success" : "body"}
          />
          {packagingFee > 0 ? <SummaryRow label="Packaging" value={naira(packagingFee)} /> : null}
          {discount > 0 ? (
            <SummaryRow label={`Discount (${couponState?.code})`} value={`− ${naira(discount)}`} tone="success" />
          ) : null}
          <Divider />
          <SummaryRow label="Total" value={naira(total)} strong />
          <Txt tone="faint" size={11} style={{ marginTop: 8, lineHeight: 16 }}>
            The shop prices every order itself. If anything differs you’ll see it before paying.
          </Txt>
        </SectionCard>
      </View>

      {pending ? (
        <View style={{ paddingHorizontal: layout.gutter, marginTop: 14 }}>
          <Notice tone="info">
            You have a payment from a moment ago that we haven’t confirmed yet. Tap {payLabel} to
            check it before starting another.
          </Notice>
        </View>
      ) : null}

    </CheckoutShell>
  );
}

/** Why a row is greyed, in the shop's voice rather than a silent disabled row. */
function unavailableReason(id: PaymentMethodId, fallback?: string): string {
  if (id === "wallet") return fallback ?? "Not enough store credit for this order";
  return "Not available right now";
}

const ov = { paddingHorizontal: layout.gutter, marginTop: 22, marginBottom: 12 } as const;
