import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChoiceRow,
  Divider,
  Field,
  Notice,
  PayBar,
  SectionCard,
  SelectField,
  SummaryRow,
  TierCards,
} from "@/components/checkout-ui";
import { CheckoutShell, SignInGate, useCheckoutAuth } from "@/components/checkout-shell";
import { Overline, Txt } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { FIELD_LABEL, useCheckout, type DeliveryMethod, type PackagingTier } from "@/lib/checkout";
import { getPickupOption, getShippingQuote, type PickupOption, type ShippingQuote } from "@/lib/checkout-api";
import { useApproxMoney } from "@/lib/currency-context";
import { STATE_OPTIONS } from "@/lib/geo";
import { layout } from "@/theme/tokens";

/**
 * Checkout, step 1 — where it goes and how it gets there.
 *
 * Split out of the old single screen for two reasons beyond length. A phone
 * shows one thing at a time, so an address form and a payment choice on one
 * scroll means the shopper cannot see what they are paying while they choose
 * how; and the address is the part that must be right BEFORE a delivery fee can
 * be quoted, which the old screen never did at all — it hard-coded `delivery =
 * 0` for a birthday-month rule with no server implementation, so the shopper
 * could be charged ₦31,000 more than the screen said.
 *
 * Every figure here is a quote. The charge is whatever POST /orders computes.
 */

const PACKAGING: { id: PackagingTier; label: string; price: number }[] = [
  { id: "standard", label: "Standard", price: 0 },
  { id: "premium", label: "Premium", price: 10_000 },
  // ₦31,000 and the id `luxe` are the server's figures. The frame and
  // mobile/CLAUDE.md both say "OGH gift / ₦30,000", which the API does not
  // accept — the old screen showed that tier and was charged nothing for it,
  // because it posted `packaging` at the top level where the server never read.
  { id: "luxe", label: "Luxe gift", price: 31_000 },
];

export default function DeliveryStep() {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const money = useApproxMoney();
  const { user, loading: authLoading, signedOut } = useCheckoutAuth();
  const { draft, ready, set, addressComplete, missing } = useCheckout();
  // The bag forwards whatever was typed into its promo field.
  const { promo } = useLocalSearchParams<{ promo?: string }>();

  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [pickup, setPickup] = useState<PickupOption | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (ready && promo && !draft.coupon) set({ coupon: promo });
  }, [ready, promo, draft.coupon, set]);

  // Seed the name from the account once, and only into empty fields, so it
  // never overwrites something the shopper typed.
  const seeded = useRef(false);
  useEffect(() => {
    if (!ready || seeded.current || !user) return;
    seeded.current = true;
    const [first = "", ...rest] = (user.name ?? "").trim().split(/\s+/);
    set({
      first_name: draft.first_name || first,
      last_name: draft.last_name || rest.join(" "),
      email: draft.email || user.email || "",
      phone: draft.phone || user.phone || "",
    });
  }, [ready, user, draft.first_name, draft.last_name, draft.email, draft.phone, set]);

  useEffect(() => {
    let cancelled = false;
    getPickupOption()
      .then((p) => !cancelled && setPickup(p))
      // A pickup lookup that fails means we simply do not offer it, which is
      // the safe direction: offering it would charge ₦0 for a collection the
      // studio may not be running.
      .catch(() => !cancelled && setPickup(null));
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-quote whenever the destination changes.
   *
   * Keyed on state only (country is fixed to NG), and the response is tagged
   * with the state it was asked for so a slow earlier reply cannot land on top
   * of a newer one.
   */
  const asked = useRef("");
  const refreshQuote = useCallback(
    (state: string) => {
      if (!state.trim()) {
        setQuote(null);
        return;
      }
      asked.current = state;
      setQuoting(true);
      setQuoteFailed(false);
      getShippingQuote("NG", state)
        .then((q) => {
          if (asked.current !== state) return;
          setQuote(q);
          setQuoting(false);
        })
        .catch(() => {
          if (asked.current !== state) return;
          setQuote(null);
          setQuoteFailed(true);
          setQuoting(false);
        });
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    refreshQuote(draft.state);
  }, [ready, draft.state, refreshQuote]);

  const pickupOn = Boolean(pickup?.enabled);

  // Keep the method honest: if pickup was chosen and then turned off, fall back
  // rather than posting a method that would be priced as standard.
  useEffect(() => {
    if (draft.method === "pickup" && pickup !== null && !pickupOn) set({ method: "standard" });
  }, [draft.method, pickup, pickupOn, set]);

  const packagingFee = useMemo(
    () => PACKAGING.find((p) => p.id === draft.packaging)?.price ?? 0,
    [draft.packaging],
  );

  const deliveryFee = useMemo(() => {
    if (draft.method === "pickup") return 0;
    if (!quote) return null;
    return draft.method === "express" ? quote.express_fee : quote.fee;
  }, [draft.method, quote]);

  const total = cart.subtotal + (deliveryFee ?? 0) + packagingFee;

  const fieldError = (key: keyof typeof FIELD_LABEL) =>
    showErrors && missing.includes(key as never) ? `${FIELD_LABEL[key]} is required.` : undefined;

  function onContinue() {
    if (!addressComplete) {
      setShowErrors(true);
      return;
    }
    router.push("/checkout/payment");
  }

  if (authLoading) return <CheckoutShell title="Checkout" step={2}>{null}</CheckoutShell>;
  if (signedOut) return <SignInGate />;

  return (
    <CheckoutShell
      title="Delivery"
      step={2}
      banner={
        showErrors && !addressComplete ? (
          <Notice tone="danger">
            {missing.length === 1
              ? `${FIELD_LABEL[missing[0]!]} is still needed.`
              : `${missing.length} fields are still needed: ${missing.map((m) => FIELD_LABEL[m]).join(", ")}.`}
          </Notice>
        ) : null
      }
      footer={
        <PayBar
          caption="Total"
          total={total}
          totalNote={deliveryFee === null ? "Delivery added once we know your state" : undefined}
          label="Continue to payment"
          disabled={cart.lines.length === 0}
          bottomInset={insets.bottom}
          onPress={onContinue}
        />
      }
    >
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 18 }}>
        <Txt tone="faint" size={12.5} style={{ lineHeight: 18 }}>
          Where should we send your verified order?
        </Txt>
      </View>

      <Overline style={ov}>DELIVERY ADDRESS</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field
              style={{ flex: 1 }}
              label="First name"
              value={draft.first_name}
              onChangeText={(v) => set({ first_name: v })}
              autoComplete="given-name"
              textContentType="givenName"
              error={fieldError("first_name")}
            />
            <Field
              style={{ flex: 1 }}
              label="Last name"
              value={draft.last_name}
              onChangeText={(v) => set({ last_name: v })}
              autoComplete="family-name"
              textContentType="familyName"
              error={fieldError("last_name")}
            />
          </View>

          <Field
            style={{ marginTop: 12 }}
            label="Phone"
            value={draft.phone}
            onChangeText={(v) => set({ phone: v })}
            placeholder="+234 800 000 0000"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            error={fieldError("phone")}
          />

          <Field
            style={{ marginTop: 12 }}
            label="Email"
            value={draft.email}
            onChangeText={(v) => set({ email: v })}
            placeholder="you@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            hint="For your receipt and delivery updates."
          />

          <Field
            style={{ marginTop: 12 }}
            label="Street address"
            value={draft.address}
            onChangeText={(v) => set({ address: v })}
            placeholder="House number & street"
            autoComplete="street-address"
            textContentType="fullStreetAddress"
            error={fieldError("address")}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Field
              style={{ flex: 1 }}
              label="City"
              value={draft.city}
              onChangeText={(v) => set({ city: v })}
              autoComplete="postal-address-locality"
              error={fieldError("city")}
            />
            <Field
              style={{ flex: 1 }}
              label="Postcode"
              value={draft.zip}
              onChangeText={(v) => set({ zip: v })}
              placeholder="100001"
              keyboardType="number-pad"
              autoComplete="postal-code"
              textContentType="postalCode"
              error={fieldError("zip")}
            />
          </View>

          <SelectField
            style={{ marginTop: 12 }}
            label="State"
            value={draft.state}
            placeholder="Select your state…"
            options={STATE_OPTIONS}
            onChange={(v) => set({ state: v })}
            error={fieldError("state")}
            bottomInset={insets.bottom}
          />

          <View style={{ marginTop: 12 }}>
            <Txt tone="faint" size={11}>
              Delivering within Nigeria.
            </Txt>
          </View>
        </SectionCard>
      </View>

      <Overline style={ov}>DELIVERY METHOD</Overline>
      <View style={{ paddingHorizontal: layout.gutter, gap: 8 }}>
        {quoteFailed ? (
          <Notice tone="info">
            We couldn’t load delivery rates just now. You can carry on — the exact fee is
            confirmed before you pay.
          </Notice>
        ) : null}

        <ChoiceRow
          title="Standard delivery"
          sub={quote?.label ? `${quote.label} · 5–7 working days` : "5–7 working days"}
          trailing={quote ? money(quote.fee) : quoting ? "…" : undefined}
          selected={draft.method === "standard"}
          onPress={() => set({ method: "standard" })}
        />
        <ChoiceRow
          title="Express delivery"
          sub="2–3 working days"
          trailing={quote ? money(quote.express_fee) : quoting ? "…" : undefined}
          selected={draft.method === "express"}
          onPress={() => set({ method: "express" })}
        />
        {pickupOn ? (
          <ChoiceRow
            title={pickup?.label || "Pickup"}
            sub={[pickup?.address, pickup?.lead].filter(Boolean).join(" · ") || undefined}
            trailing="Free"
            selected={draft.method === "pickup"}
            onPress={() => set({ method: "pickup" })}
          />
        ) : null}
      </View>

      <Overline style={ov}>PACKAGING</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <TierCards options={PACKAGING} value={draft.packaging} onChange={(id) => set({ packaging: id })} />
      </View>

      <Overline style={ov}>DELIVERY NOTE (OPTIONAL)</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          <Field
            label="Anything we should know?"
            value={draft.note}
            onChangeText={(v) => set({ note: v })}
            placeholder="Gate code, landmark, best time to deliver…"
            maxLength={400}
          />
        </SectionCard>
      </View>

      <Overline style={ov}>ORDER SUMMARY</Overline>
      <View style={{ paddingHorizontal: layout.gutter }}>
        <SectionCard>
          <SummaryRow label={`Bag (${cart.count} ${cart.count === 1 ? "item" : "items"})`} value={money(cart.subtotal)} />
          <SummaryRow
            label="Delivery"
            value={deliveryFee === null ? "—" : deliveryFee === 0 ? "Free" : money(deliveryFee)}
            tone={deliveryFee === 0 ? "success" : "body"}
            pending={quoting}
          />
          {packagingFee > 0 ? <SummaryRow label="Packaging" value={money(packagingFee)} /> : null}
          <Divider />
          <SummaryRow label="Total" value={money(total)} strong />
          <Txt tone="faint" size={11} style={{ marginTop: 8, lineHeight: 16 }}>
            Confirmed on the next step — the shop prices every order itself.
          </Txt>
        </SectionCard>
      </View>

    </CheckoutShell>
  );
}

const ov = { paddingHorizontal: layout.gutter, marginTop: 22, marginBottom: 12 } as const;
