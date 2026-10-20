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
import { CountryField } from "@/components/country-field";
import { Overline, Txt } from "@/components/ui";
import { useCart } from "@/lib/cart";
import {
  FIELD_LABEL,
  useCheckout,
  type DeliveryMethod,
  type PackagingTier,
} from "@/lib/checkout";
import { getPickupOption, getShippingQuote, type PickupOption, type ShippingQuote } from "@/lib/checkout-api";
import { useApproxMoney } from "@/lib/currency-context";
import {
  REGION_MAX,
  clampRegion,
  hasPostcode,
  postcodeKeyboard,
  postcodeLabel,
  regionLabel,
  regionOptions,
  usesStateList,
} from "@/lib/geo";
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
  /**
   * WHICH destination has a quote outstanding, not merely that one does.
   *
   * This was a bare boolean, and two of the exit paths in `refreshQuote` never
   * cleared it: it stuck true with no request in flight, and the delivery rows
   * then showed the waiting ellipsis where a price belongs for the rest of the
   * visit. Keying it on the destination lets each reply settle its OWN request
   * and leave a newer one's indicator alone, which a boolean cannot express.
   */
  const [quotingFor, setQuotingFor] = useState<string | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [pickup, setPickup] = useState<PickupOption | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  /** A rate has been asked for and not answered: the delivery rows show it. */
  const quoting = quotingFor !== null;

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
   * The destination is the COUNTRY as much as the region. The server prices in
   * `ShippingFee::quote($country, $state)`, matching country + state, then
   * country alone, then a flat fallback — so asking it about "NG" while the
   * shopper had chosen Ghana quoted a Nigerian zone for a Ghanaian parcel, and
   * POST /orders would then charge the real rate. A quote that is wrong in
   * this direction is money, not decoration.
   *
   * Two rules follow from how those zones are keyed (lib/geo.ts):
   *
   *  · INSIDE NIGERIA THERE IS NOTHING TO QUOTE UNTIL THE STATE IS KNOWN,
   *    because the Nigerian zones are keyed on the state string. Everywhere
   *    else they are country-level, so a country on its own already answers
   *    the question and the fee appears before a region is typed.
   *  · THE REGION IS TYPED outside Nigeria, so the request is debounced in
   *    the effect below; keyed straight off the draft it fired once per
   *    keystroke.
   *
   * Each reply is tagged with the destination it was asked about, in
   * `asked.current`, so a slow earlier one cannot land on top of a newer one.
   * The tag is claimed in the effect below, as the destination changes, and
   * not here when the debounced request finally goes out — see why there.
   */
  const asked = useRef("");
  const refreshQuote = useCallback(
    (country: string, state: string) => {
      const region = state.trim();
      if (usesStateList(country) && !region) {
        // Nothing to ask yet, so nothing is outstanding. Both halves of that
        // sentence have to be written down: the tag is claimed so a reply for
        // the country we came from cannot land, and the indicator is settled
        // because this path used to leave it claiming a rate was on its way
        // when no request existed to answer it.
        asked.current = `${country}|`;
        setQuote(null);
        setQuoteFailed(false);
        setQuotingFor(null);
        return;
      }

      const key = `${country}|${region}`;
      // Settles the indicator for THIS request and no other. Clearing it
      // outright would hide the wait of a newer request still in flight, and a
      // reply about to be discarded must still account for itself — between
      // them, those two cases are how the old boolean got stuck.
      const settle = () => setQuotingFor((k) => (k === key ? null : k));

      asked.current = key;
      setQuotingFor(key);
      setQuoteFailed(false);
      getShippingQuote(country, region)
        .then((q) => {
          settle();
          if (asked.current !== key) return;
          setQuote(q);
        })
        .catch(() => {
          settle();
          if (asked.current !== key) return;
          setQuote(null);
          setQuoteFailed(true);
        });
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;

    /**
     * The destination is claimed HERE, the moment it changes, and not 350ms
     * later when the debounce fires.
     *
     * Claiming it only inside `refreshQuote` left a 350ms window in which the
     * tag still named the country the shopper had just left, so a reply in
     * flight for it still matched and landed — the exact thing the tag exists
     * to prevent. Walked through: Great Britain with a blank region and a
     * quote in flight; at t=1000ms the shopper picks Nigeria and the region is
     * cleared with it; at t=1350ms the debounce early-returns because the
     * Nigerian state is not known yet, and the British reply then arrives
     * against a form waiting on that state and is priced into the Total.
     *
     * And a fee quoted for the destination they just left is not a slightly
     * stale number, it is the wrong one, so it goes immediately rather than
     * sitting under the Total for as long as the new quote takes.
     *
     * THE DESTINATION IS THE COUNTRY — AND, INSIDE NIGERIA, THE STATE TOO.
     * This was keyed on the country alone, justified by "outside Nigeria the
     * region does not price anything": true there, and exactly inverted for
     * Nigeria, the one country whose zones ARE matched on the state and the
     * shop's dominant market. Switching Lagos (within-state, ₦5,000) to Borno
     * (inter-state or the ₦31,000 fallback) left ₦5,000 sitting under the Total
     * with nothing to say it was pending, and the server then charged the real
     * rate. Outside Nigeria a typed region still keeps its fee, because there
     * the country is what prices the parcel.
     *
     * The shape matches `refreshQuote`'s own tag exactly — `country|region`,
     * trimmed and case-preserved — because a destination that could not equal
     * the tag would reset the quote on every render instead of once.
     */
    const destination = `${draft.country}|${usesStateList(draft.country) ? draft.state.trim() : ""}`;
    const sameDestination = usesStateList(draft.country)
      ? asked.current === destination
      : asked.current.startsWith(destination);
    if (!sameDestination) {
      asked.current = destination;
      setQuote(null);
      setQuoteFailed(false);
      setQuotingFor(null);
    }

    // Cancelled and restarted on every change, so a free-text region costs one
    // request when the typing stops rather than one per letter of
    // "Greater London".
    const t = setTimeout(() => refreshQuote(draft.country, draft.state), 350);
    return () => clearTimeout(t);
  }, [ready, draft.country, draft.state, refreshQuote]);

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

  /**
   * What this country calls the field an error is about.
   *
   * FIELD_LABEL (lib/checkout.tsx) is country-blind — "State" and "Postcode"
   * — so a Canadian whose form says Province was being told "State is
   * required" about a box that is not on the screen. The other five labels
   * never change.
   *
   * It is only ever asked about a field that IS missing, which is why the
   * countries with no region to name never reach the `state` branch: the
   * required list drops `state` for them (`regionRequired()` via
   * `requiredFor()` in lib/checkout.tsx), so a shopper in Singapore or Monaco
   * cannot be told a region is required — the same way `zip` cannot be
   * demanded where there is no postal system.
   */
  const labelFor = useCallback(
    (key: string) => {
      if (key === "state") return regionLabel(draft.country);
      if (key === "zip") return postcodeLabel(draft.country);

      return FIELD_LABEL[key] ?? key;
    },
    [draft.country],
  );

  const fieldError = (key: string) =>
    showErrors && missing.includes(key as never) ? `${labelFor(key)} is required.` : undefined;

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
              ? `${labelFor(missing[0]!)} is still needed.`
              : `${missing.length} fields are still needed: ${missing.map(labelFor).join(", ")}.`}
          </Notice>
        ) : null
      }
      footer={
        <PayBar
          caption="Total"
          total={total}
          totalNote={
            // Which part is still missing depends on the country: Nigeria is
            // priced by state, everywhere else by the country itself, so a
            // blank fee there means the rate has not arrived rather than that
            // we are waiting on the shopper.
            deliveryFee === null
              ? usesStateList(draft.country)
                ? `Delivery added once we know your ${regionLabel(draft.country).toLowerCase()}`
                : "Delivery added once we have your country’s rate"
              : undefined
          }
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
          {/* The COUNTRY leads the card, because it decides what the boxes
              below it are called, whether the postcode exists at all, and
              which zone prices the delivery. A picker sitting under the fields
              it relabels makes the form rearrange itself after it has already
              been filled in. */}
          <CountryField
            value={draft.country}
            onChange={(code) => {
              // A region and a postcode belong to the country they were typed
              // in, so both go when the country does — unconditionally.
              //
              // The old rule cleared the region only when the KIND of input
              // changed (picker versus free text) and the postcode only when
              // the new country had none, which quietly carried an address
              // across a border. A South African address reading "Gauteng"
              // with a South African postcode, switched to Great Britain, kept
              // both: `usesStateList("GB")` equals `usesStateList("ZA")`, and
              // both countries have postcodes. POST /orders was then handed
              // { state: "Gauteng", zip: <ZA code>, country: "GB" } and the
              // parcel was priced, routed and labelled on a province eight
              // thousand kilometres from where it was going. Retyping two
              // boxes after fixing a mis-picked country is much the cheaper of
              // the two mistakes.
              set({ country: code, state: "", zip: "" });
            }}
            hint="Sets which delivery rates apply."
            bottomInset={insets.bottom}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
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
            // A Nigerian sample number is a helpful example in Nigeria and a
            // misleading one anywhere else — it reads as the shop asking for
            // a Nigerian line.
            placeholder={
              draft.country === "NG" ? "+234 800 000 0000" : "Include your country code"
            }
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
            // The same worked examples the account screens show, so that one
            // address is not asked for in three different ways across the app.
            // Outside Nigeria the wording leads with "Flat," deliberately: the
            // unit is the line an international courier needs and the one
            // shoppers leave out.
            placeholder={
              draft.country === "NG"
                ? "14 Admiralty Way, Lekki Phase 1"
                : "Flat, house number and street"
            }
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
              placeholder={draft.country === "NG" ? "Lagos" : "Town or city"}
              autoComplete="postal-address-locality"
              error={fieldError("city")}
            />
            {/* Shown wherever there is a code to write, which is a different
                question from whether we insist on one: `hasPostcode()` draws
                the box and `postcodeRequired()` demands it, through
                requiredFor() in lib/checkout.tsx, which is what Continue
                reads. Ireland is the case that needs both to be asked
                separately — an Eircode is real and worth capturing, and asking
                this screen the required question left an Irish shopper with
                nowhere at all to put the one they had. Where there is no
                postal system the box is absent, an empty box with no possible
                answer reading as a form you have failed to finish, and City
                then takes the whole row. */}
            {hasPostcode(draft.country) ? (
              <Field
                style={{ flex: 1 }}
                label={postcodeLabel(draft.country)}
                value={draft.zip}
                onChangeText={(v) => set({ zip: v })}
                placeholder={draft.country === "NG" ? "106104" : undefined}
                // Letters are unreachable on a number pad, and half the
                // world's postcodes contain them — see postcodeKeyboard().
                keyboardType={postcodeKeyboard(draft.country)}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="postal-code"
                textContentType="postalCode"
                error={fieldError("zip")}
              />
            ) : null}
          </View>

          {/* Picked inside Nigeria, typed everywhere else, and labelled with
              the country's own word for it, so a Canadian is not asked for a
              "State" nor a Briton for a "Province". The Nigerian list is not
              tidiness: its zones are keyed on those exact 37 strings, and a
              typed "Abuja" misses its zone and is quoted the fallback fee. */}
          {usesStateList(draft.country) ? (
            <SelectField
              style={{ marginTop: 12 }}
              label={regionLabel(draft.country)}
              value={draft.state}
              placeholder={`Select your ${regionLabel(draft.country).toLowerCase()}…`}
              options={regionOptions(draft.country)}
              onChange={(v) => set({ state: v })}
              error={fieldError("state")}
              bottomInset={insets.bottom}
            />
          ) : (
            <Field
              style={{ marginTop: 12 }}
              label={regionLabel(draft.country)}
              value={draft.state}
              onChangeText={(v) => set({ state: clampRegion(v) })}
              autoCapitalize="words"
              autoComplete="postal-address-region"
              // 60, because the two endpoints disagree and this is the
              // stricter of them: GET /api/shipping/quote validates `state` as
              // max:60 while POST /orders allows max:120. A longer region
              // therefore 422s the QUOTE for good while the ORDER goes
              // through — the Delivery row reads "—", the Total above the Pay
              // button silently omits the fee, and the shop charges it anyway.
              maxLength={REGION_MAX}
              error={fieldError("state")}
            />
          )}

          {/* Said once, under the field it is about, and only while that
              field is not already being told off: a demand ("State is
              required.") with a neutral explainer stacked under it reads as
              the form arguing with itself. Which field sets the fee depends on
              the country — Nigeria prices per state, everywhere else the zones
              are country-level — and SelectField takes no `hint`, which is why
              the line lives out here rather than under the input. */}
          {fieldError("state") ? null : (
            <View style={{ marginTop: 12 }}>
              <Txt tone="faint" size={11}>
                {usesStateList(draft.country)
                  ? `Your ${regionLabel(draft.country).toLowerCase()} sets the delivery fee.`
                  : "Outside Nigeria the delivery fee is set by the country."}
              </Txt>
            </View>
          )}
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
            // The SERVER's cap. `OrderController::store` validates
            // `delivery.note` as max:300, so 400 here invited a note the order
            // would refuse — and the refusal surfaces on the PAYMENT step, which
            // has no note field to correct, as Laravel's raw "The delivery.note
            // field must not be greater than 300 characters."
            maxLength={300}
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
          {/* Say WHY it is free. A ₦0 delivery with no explanation reads as a
              glitch, or as a promotion the shopper has not understood — and
              this one is personal, so it is worth naming. The server decides
              it; this only reports what the quote came back with. */}
          {quote?.birthday_free ? (
            <Txt tone="success" size={11.5} style={{ marginTop: 6, lineHeight: 16 }}>
              Delivery is on us — it’s your birthday month.
            </Txt>
          ) : null}
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
