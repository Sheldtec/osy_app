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
import { signedMoney } from "@/lib/currency";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { naira } from "@/lib/format";
import { countryName, hasPostcode, normalizeCountry, usesStateList } from "@/lib/geo";
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

/**
 * The figures a coupon preview was taken against, as one comparable string.
 *
 * Module scope on purpose: it is read inside a `useCallback`, and a function
 * rebuilt on every render would have to join that callback's dependencies,
 * which would rebuild the callback on every render and re-fire the effects
 * that depend on it forever.
 */
function couponBasis(code: string, subtotal: number, delivery: number): string {
  return `${code}|${subtotal}|${delivery}`;
}

export default function PaymentStep() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { user, loading: authLoading, signedOut } = useCheckoutAuth();
  const { draft, ready, set, addressComplete, pending, setPending } = useCheckout();
  const money = useApproxMoney();
  const { code: currency } = useCurrency();

  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [chosen, setChosen] = useState<PaymentMethodId | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  /**
   * Whether the ₦0 delivery is the customer's birthday month.
   *
   * Tracked separately because this screen keeps only the FEE, and a bare "Free"
   * on the last screen before money moves is where it most needs explaining —
   * an unexplained discount reads as a mistake about to be corrected. The server
   * decides it; this only reports what the quote said.
   */
  const [birthdayFree, setBirthdayFree] = useState(false);
  /**
   * The destination the fee currently on screen was quoted for.
   *
   * A ref, not state: it only decides whether to discard a fee, so writing it
   * must not itself cause a render.
   */
  const quotedFor = useRef("");

  const [coupon, setCoupon] = useState(draft.coupon);
  const [couponState, setCouponState] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | undefined>();
  const [couponBusy, setCouponBusy] = useState(false);
  /**
   * The figures the coupon on screen was last priced against.
   *
   * A ref for the same reason as `quotedFor` above: it only decides whether a
   * preview needs taking again, so writing it must not itself cause a render.
   * Claimed before the request goes out, so a code the server refuses is never
   * retried in a loop by the effects below.
   */
  const couponPricedFor = useRef<string | null>(null);
  /** Whether a code chosen before arriving here has had its one attempt. */
  const couponSeeded = useRef(false);

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

  /**
   * The same quote step 1 showed, asked again about the same destination.
   *
   * It has to be the DRAFT'S country. Pinned to "NG", this screen quoted a
   * Nigerian zone for a parcel to Ghana, so the total sitting above the Pay
   * button disagreed with what POST /orders would charge — and this is the
   * last figure anyone sees before money moves. Nigeria is priced on the
   * state, so there is nothing to ask until it exists; everywhere else the
   * zones are country-level and the country alone is the whole question
   * (lib/geo.ts).
   */
  useEffect(() => {
    if (!ready) return;
    if (usesStateList(draft.country) && !draft.state.trim()) {
      // There is nothing to ask, and nothing is also the honest answer: the
      // fee standing here was quoted for the country the shopper has since
      // left, so leaving it would price a Nigerian parcel on a British zone in
      // the Total immediately above the Pay button. Null makes the row read
      // "—" and the PayBar say the delivery is not included yet.
      setDeliveryFee(null);
      setBirthdayFree(false);
      // Claimed, so the next run does not read this as a fresh destination
      // change and clear what is already cleared.
      quotedFor.current = `${draft.country}|`;
      return;
    }
    // Drop the OLD destination's fee before asking about the new one — but
    // ONLY when the destination is what changed.
    //
    // Step 1 does this (`app/checkout/index.tsx`, its `destination` key) and
    // this screen did not, so the fee survived the round trip: tap Change,
    // switch the country, come back with the system gesture rather than
    // Continue, and this already-mounted screen re-quoted while still
    // printing the fee for the country just left — under the Total,
    // immediately above the Pay button, for as long as `lib/http.ts` takes
    // to answer (TIMEOUT_MS is 12s). A fee for the wrong destination is not
    // stale, it is wrong, and this is the last figure before money moves.
    //
    // Gated on the destination because `draft.method` is a dependency here
    // too: clearing unconditionally blanked the row to “—” and — now that Pay
    // is disabled while the fee is unknown — killed the Pay button for a
    // whole round trip every time someone toggled Standard/Express, where
    // the old fee was never wrong, just about to be replaced by the other
    // half of a quote we already hold.
    const destination = `${draft.country}|${usesStateList(draft.country) ? draft.state.trim() : ""}`;
    if (quotedFor.current !== destination) {
      quotedFor.current = destination;
      setDeliveryFee(null);
      setBirthdayFree(false);
    }

    let cancelled = false;
    getShippingQuote(draft.country, draft.state.trim())
      .then((q) => {
        if (cancelled) return;
        setDeliveryFee(draft.method === "pickup" ? 0 : draft.method === "express" ? q.express_fee : q.fee);
        // Not on a pickup: nothing was given up, so there is nothing to thank
        // anyone for — and the server does not spend the claim on one either.
        setBirthdayFree(Boolean(q.birthday_free) && draft.method !== "pickup");
      })
      .catch(() => {
        if (cancelled) return;
        setDeliveryFee(null);
        setBirthdayFree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, draft.country, draft.state, draft.method]);

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
              ? `Balance ${money(balance)} — ${money(total - balance)} short`
              : `Balance ${money(balance)}`,
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
  }, [methods, balance, total, money]);

  // Pick the first method that actually works, once, rather than defaulting to
  // one the server would refuse.
  useEffect(() => {
    if (chosen || rows.length === 0) return;
    const first = rows.find((r) => r.available);
    if (first) setChosen(first.id);
  }, [rows, chosen]);

  /* ---------------- coupon ---------------- */

  const applyCoupon = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;

      couponPricedFor.current = couponBasis(code, cart.subtotal, (deliveryFee ?? 0) + packagingFee);
      setCouponBusy(true);
      setCouponError(undefined);
      try {
        // Shipping PLUS packaging, because that is what the server discounts.
        //
        // `OrderController::store` passes `$deliveryFee = shipping + packaging`
        // into `CouponService::evaluate()`, and the `free_shipping` branch
        // discounts the whole of it. Sending only the shipping half made the
        // preview under-report: a Lagos order with Luxe packaging showed
        // “FREE SHIPPING — you save ₦5,000” and was then charged ₦36,000 less, so
        // the banner, the Total on this screen and the amount taken were three
        // different numbers.
        //
        // Whether “free shipping” SHOULD pay for gift packaging is a separate
        // question for the shop — this only makes the preview tell the truth about
        // what the server already does.
        const preview = await previewCoupon(code, cart.subtotal, (deliveryFee ?? 0) + packagingFee);
        setCouponState(preview);
        // The server's spelling of the code, which is the one the order will
        // carry, so the field stops showing a variant of it.
        setCoupon(preview.code);
        set({ coupon: preview.code });
      } catch (err) {
        setCouponState(null);
        /*
         * The server's own refusal, and its field-scoped one by preference.
         *
         * `/coupons/apply` answers an ineligible code with CouponService's
         * sentence in `message` — "This code is for new customers only.",
         * "Spend at least ₦200,000 to use this code.", "This code can only be
         * used on the website." — and a malformed request with Laravel's
         * `{message, errors}`, where `message` is a summary that can trail off
         * into "(and 2 more errors)". `errors.code` is the part about the code
         * itself, so it wins when it is there. Our own sentence is reached only
         * when the throw was not an API answer at all.
         */
        setCouponError(
          err instanceof CheckoutError
            ? (err.fieldError("code") ?? err.message)
            : "That code could not be checked.",
        );
      } finally {
        setCouponBusy(false);
      }
    },
    [cart.subtotal, deliveryFee, packagingFee, set],
  );

  /**
   * A coupon the shopper chose before they got here, actually applied.
   *
   * "Use at checkout" on the Coupons screen verifies a code and writes it into
   * the draft. This screen will not put a raw draft string into the order
   * payload — only a code it has previewed itself (see `pay()`) — which is the
   * right rule and stays. With nothing bridging the two, those two correct
   * rules met in the middle and produced a lie: a shopper tapped a valid
   * ₦20,000 coupon, arrived to find the code sitting in the field, no Discount
   * row, and paid full price believing the coupon was on.
   *
   * The bridge is a preview taken HERE, because this is the only screen that
   * knows the delivery fee — and a free-shipping code's entire worth IS the
   * delivery, so the Coupons screen could never have previewed one as anything
   * but a saving of ₦0. Waiting for the quote is the same reason.
   *
   * One attempt per visit. If the server now refuses the code, its words go
   * under the field, so the shopper is told plainly rather than left to notice
   * a discount that never arrived.
   */
  useEffect(() => {
    if (couponSeeded.current || !ready || deliveryFee === null) return;
    // A code applied here by hand is the shopper's own doing and needs no
    // seeding — and since `applyCoupon` writes the draft, the draft agreeing
    // with the applied code proves nothing on its own.
    if (couponState || couponBusy) return;

    const code = draft.coupon.trim();
    if (!code) return;

    couponSeeded.current = true;
    setCoupon(code);
    void applyCoupon(code);
  }, [ready, deliveryFee, draft.coupon, couponState, couponBusy, applyCoupon]);

  /**
   * Re-price a free-shipping code when the delivery it pays for changes.
   *
   * Only that type. `CouponService::discountFor()` computes a percent or fixed
   * discount from the subtotal alone, and nothing on this screen changes the
   * subtotal, so re-asking about those would spend the shopper's 30-a-minute
   * coupon throttle to be told the same number. Free shipping is different: it
   * is worth exactly the delivery, down to the zone and the Standard/Express
   * choice. Now that the code is applied on arrival — before the shopper has
   * picked either — a saving priced against the fee they have since left is
   * easy to reach, and it sits in the Total immediately above the Pay button.
   */
  useEffect(() => {
    if (!couponState || couponBusy || deliveryFee === null) return;
    if (couponState.type !== "free_shipping") return;

    const basis = couponBasis(couponState.code, cart.subtotal, deliveryFee + packagingFee);
    if (couponPricedFor.current === basis) return;

    void applyCoupon(couponState.code);
  }, [couponState, couponBusy, deliveryFee, packagingFee, cart.subtotal, applyCoupon]);

  function clearCoupon() {
    setCoupon("");
    setCouponState(null);
    setCouponError(undefined);
    couponPricedFor.current = null;
    // Taken off deliberately, so it must not be seeded straight back out of
    // the draft by the effect above.
    couponSeeded.current = true;
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
        // A postcode the form did not show must not be posted either: the
        // draft is cleared when the country changes, but one restored from
        // storage can still hold a code for a country that issues none, and
        // the courier would be handed a number nobody has seen since.
        //
        // `hasPostcode()` and not `postcodeRequired()`, which is the same
        // choice the account screens make (app/account/address.tsx,
        // app/account/profile.tsx): the question here is whether the box was
        // on screen, not whether we insisted on it. Asking the required
        // question threw away an Eircode a Dublin shopper had just typed into
        // step 1's visible, optional field — entered, shown back to them, and
        // then dropped from the order for not having been compulsory. What
        // blocks the payment is still `postcodeRequired()`, through
        // requiredFor() behind `addressComplete` on the Pay button.
        zip: hasPostcode(draft.country) ? draft.zip.trim() : "",
        // The country the shopper chose, not the one this screen used to
        // assume — the server prices, routes and ships on this string.
        // `normalizeCountry` only guards its shape (blank, lower case); it
        // never rewrites a code it cannot name.
        country: normalizeCountry(draft.country),
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
      //
      // That is still the rule. What changed is that a pre-chosen code no
      // longer dies here: the effect above previews it on arrival, so by the
      // time this runs a code from the Coupons screen either IS the applied
      // one or has been refused out loud.
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
          // The order is the binding judgement, so a code it refused is dead:
          // drop it from the draft too, or the next visit to this screen would
          // seed it back and refuse it again before the shopper has typed
          // anything.
          set({ coupon: "" });
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
          // `deliveryFee === null` means the quote has not resolved — offline, a
          // 429 from the shipping throttle, any non-2xx. Pay stayed enabled on
          // a Total that simply omitted delivery, so the wallet affordability
          // check was made against a figure ₦31,000 short of what the server
          // would charge. A shopper could commit to a price nobody had quoted.
          //
          // `couponBusy` for the mirror of that: a coupon is being priced, so
          // the Total on the button is not yet the discounted one. It matters
          // most on arrival, where the code the shopper picked on the Coupons
          // screen is applied for them — paying during that round trip would
          // charge full price for a coupon they had already chosen.
          disabled={
            !chosen ||
            cart.lines.length === 0 ||
            !addressComplete ||
            deliveryFee === null ||
            couponBusy
          }
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
                {/* The country belongs on the line now that it can be any
                    of them: an address that stops at the state reads as a
                    domestic delivery whatever was chosen a step earlier.
                    The postcode is gated on the same condition as the payload
                    below, because this line is a promise about what we are
                    about to send. A draft restored from storage can still
                    hold a code for a country that issues none — step 1 hides
                    the box, the order posts no zip, and this line was printing
                    "…, 00000, United Arab Emirates" over the Pay button: an
                    address the shopper cannot edit here and the shop will
                    never use. */}
                {[
                  draft.address,
                  draft.city,
                  draft.state,
                  hasPostcode(draft.country) ? draft.zip : "",
                  countryName(draft.country),
                ]
                  .filter(Boolean)
                  .join(", ")}
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
                onPress={() => {
                  if (couponState) clearCoupon();
                  else void applyCoupon(coupon);
                }}
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
                {couponState.label} applied — you save {money(discount)}.
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
                value={money((netPriceForLength(l.product, l.length) + (l.surcharge ?? 0)) * l.qty)}
              />
              {l.length || l.colour || l.preparationTitle ? (
                <Txt tone="faint" size={11} style={{ marginTop: 1 }}>
                  {[l.length, l.colour, l.preparationTitle].filter(Boolean).join(" · ")}
                </Txt>
              ) : null}
            </View>
          ))}
          <Divider />
          <SummaryRow label="Subtotal" value={money(cart.subtotal)} />
          <SummaryRow
            label={draft.method === "express" ? "Express delivery" : draft.method === "pickup" ? "Pickup" : "Delivery"}
            value={deliveryFee === null ? "—" : deliveryFee === 0 ? "Free" : money(deliveryFee)}
            tone={deliveryFee === 0 ? "success" : "body"}
          />
          {birthdayFree ? (
            <Txt tone="success" size={11.5} style={{ marginTop: 6, lineHeight: 16 }}>
              Delivery is on us — it’s your birthday month.
            </Txt>
          ) : null}
          {packagingFee > 0 ? <SummaryRow label="Packaging" value={money(packagingFee)} /> : null}
          {discount > 0 ? (
            <SummaryRow label={`Discount (${couponState?.code})`} value={signedMoney(money(discount), "−")} tone="success" />
          ) : null}
          <Divider />
          <SummaryRow label="Total" value={money(total)} strong />
          {/*
           * The bridge to what the gateway will actually take.
           *
           * Every figure on this screen now follows the shopper's chosen
           * currency, the Pay button included — so on a non-Naira setting this
           * line is the ONLY place the real charge appears. Without it the
           * gateway's own page is the first time anyone sees a Naira amount,
           * which is the wrong moment to learn it.
           */}
          {currency !== "NGN" ? (
            <Txt tone="body" size={11} style={{ marginTop: 8 }}>
              Charged in {naira(total)}
            </Txt>
          ) : null}
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
