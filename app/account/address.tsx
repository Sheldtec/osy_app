import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  SectionLabel,
} from "@/components/account-ui";
import { Field, SelectField } from "@/components/checkout-ui";
import { CountryField } from "@/components/country-field";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCheckout } from "@/lib/checkout";
import {
  REGION_MAX,
  clampRegion,
  DEFAULT_COUNTRY,
  hasPostcode,
  normalizeCountry,
  postcodeKeyboard,
  postcodeLabel,
  postcodeRequired,
  regionLabel,
  regionOptions,
  regionRequired,
  usesStateList,
} from "@/lib/geo";
import { ApiError } from "@/lib/http";
import { getProfile, updateProfile, type Profile } from "@/lib/profile-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Saved address — the account's ONE default delivery address, on its own screen.
 *
 * The account list has carried two rows, "My details" and "Saved address · Where
 * your orders are delivered", pointing at the same `/account/profile` form. The
 * second was a row that promised a screen and delivered someone else's: a
 * shopper who tapped it to fix a street name landed in a form about their name,
 * phone and date of birth, with the address four fields further down. There is
 * still only ONE address on the account — this is not an address book — but the
 * thing people go looking for now gets the screen it was advertised as having.
 *
 * Three things here are load-bearing rather than cosmetic:
 *
 *  · THE SAVE RESENDS WHAT IT DID NOT ASK FOR. `PATCH /auth/profile` requires
 *    `name` (AuthController::updateProfile), and `updateProfile()` writes
 *    `phone` and `dob` UNCONDITIONALLY from its input, blank becoming null. So
 *    an address-only call that passed only the address would 422 on the missing
 *    name and — had it sent an empty one — blank the customer's name, phone and
 *    birthday with it. All three are read off the loaded profile and sent
 *    straight back. The address columns are `sometimes` server-side, which is
 *    what makes the reverse safe: My details may keep editing them too.
 *
 *  · AN ADDRESS IS ALL OR NOTHING. Checkout needs the address before it will
 *    price an order (`REQUIRED` in lib/checkout.tsx), so a three-quarters-
 *    filled address saves cleanly here and then blocks the basket later,
 *    somewhere this screen cannot explain itself. Either the whole address or
 *    none of it — emptying every box genuinely removes it.
 *
 *  · THE STATE IS MONEY, INSIDE NIGERIA. The server matches shipping zones on
 *    that exact string, so Nigeria keeps the curated picker (see lib/geo.ts):
 *    a typed "Abuja" that misses its zone is the fallback rate rather than the
 *    real one. Everywhere else the zones are country-level, so the region is
 *    free text and the COUNTRY is the part that moves the money.
 *
 *  · THE POSTCODE IS NOT UNIVERSAL, AND "HAS ONE" IS NOT "MUST HAVE ONE".
 *    Around a third of the countries we ship to have no postal code system at
 *    all — Hong Kong, the Emirates, Ghana — so for them the box is neither
 *    shown nor demanded. Ireland sits between the two: an Eircode is real and
 *    worth capturing, but most Irish addresses are still written without one.
 *    So the two questions are asked separately — `hasPostcode()` decides
 *    whether to RENDER the field, `postcodeRequired()` whether the save may be
 *    BLOCKED on it — and Dublin gets a box it does not have to fill. The
 *    server agrees with the lenient half: `zip` is nullable and is not
 *    validated on order creation.
 *
 * Field layout, labels and placeholders are deliberately identical to the
 * address block in `account/profile.tsx` — the two screens write the same five
 * columns and must not read as two different forms.
 */

/** The four the checkout cannot price an order without. */
const PARTS = ["address", "city", "state", "zip"] as const;

type Part = (typeof PARTS)[number];

/**
 * The parts THIS country actually has.
 *
 * A part is only MISSING in a country that has one to give. In the ~67 that
 * issue no postcode (`postcodeRequired()` in lib/geo.ts) an empty box is not an
 * unfinished field, it is a field with no answer, and holding the save hostage
 * to it would make the screen unusable in Accra or Dubai. The same is true of
 * the region in a city-state (`regionRequired()`): asking Singapore for a
 * province makes the shopper invent one — usually by retyping the city — just
 * to get past the form.
 *
 * Deliberately the same two predicates `requiredFor()` in lib/checkout.tsx
 * uses. This screen is where an address is saved and that one is where it is
 * priced, so a difference between them is an address that saves here and then
 * blocks the basket there, somewhere this screen cannot explain itself.
 *
 * Note the asymmetry with the RENDERED postcode field below, which asks
 * `hasPostcode()`: Ireland shows a box and is not required to fill it.
 */
function partsFor(country: string): readonly Part[] {
  return PARTS.filter(
    (p) =>
      (p !== "zip" || postcodeRequired(country)) &&
      (p !== "state" || regionRequired(country)),
  );
}

/** What to call a part mid-sentence — two of the four depend on the country. */
function partLabel(part: Part, country: string): string {
  if (part === "address") return "street address";
  if (part === "city") return "city";

  return (part === "state" ? regionLabel(country) : postcodeLabel(country)).toLowerCase();
}

/** Shown on each empty box when only some of the address was filled in. */
const NEEDED = "Needed before we can price delivery.";

export default function AddressScreen() {
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();
  const { set: setDraft, ready: draftReady } = useCheckout();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const fill = useCallback((p: Profile) => {
    setProfile(p);
    setAddress(p.address ?? "");
    setCity(p.city ?? "");
    // Clamped on LOAD as well as on save: these columns are also written by
    // the website, where the same box accepted 120 characters, and a value
    // over 60 makes every shipping quote 422 for ever (see REGION_MAX).
    setState(clampRegion(p.state));
    setZip(p.zip ?? "");
    // An account that holds an unrecognised code keeps it: `normalizeCountry`
    // only fills in the blank, it does not rewrite a country it cannot name.
    setCountry(normalizeCountry(p.country));
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadError(null);
      try {
        fill(await getProfile());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof ApiError ? err.message : "We couldn’t load your address.",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [fill],
  );

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  /**
   * The postcode as it would actually be SENT.
   *
   * Dropped where the country has no postal system for it to belong to, and
   * read by `dirty` as well as by the save — so the button and the request can
   * never disagree about whether there is anything left to change.
   *
   * That agreement is the whole point. `dirty` used to compare the raw box, and
   * the save stripped the value: a profile written on the website can hold a
   * country with no postal code and a code anyway (Ghana plus "00233"), and on
   * this screen no postcode box is drawn for it, so nothing was editable that
   * would make the form dirty. Save stayed greyed out and the orphan could not
   * be cleared from the screen that OWNS the address. Comparing the effective
   * value makes the form dirty on load, which is correct: there IS something to
   * change.
   */
  const effectiveZip = useMemo(
    () => (hasPostcode(country) ? zip.trim() : ""),
    [country, zip],
  );

  /** Anything the save would actually change since the last successful one. */
  const dirty = useMemo(() => {
    if (!profile) return false;

    return (
      address.trim() !== (profile.address ?? "") ||
      city.trim() !== (profile.city ?? "") ||
      clampRegion(state) !== (profile.state ?? "") ||
      effectiveZip !== (profile.zip ?? "") ||
      country !== normalizeCountry(profile.country)
    );
  }, [profile, address, city, state, effectiveZip, country]);

  async function save() {
    if (!profile) return;

    setError(null);
    setFields({});
    setSaved(false);

    const next = {
      address: address.trim(),
      city: city.trim(),
      state: clampRegion(state),
      // `effectiveZip`, so this and `dirty` cannot disagree. The memo asks
      // `hasPostcode()` and not `postcodeRequired()` on purpose: it has to
      // match the box that is actually ON SCREEN, so a country with no
      // postal system saves nothing (a code left over from the previous
      // country must not travel to the courier unseen) while an Eircode a
      // Dublin shopper typed into a visible, optional field survives rather
      // than being thrown away for not having been compulsory.
      zip: effectiveZip,
    };
    // Not PARTS: an address has as many parts as the country gives it — three
    // where no postcode is issued, three in a city-state with no region — and
    // demanding one that does not exist makes the screen impossible to finish.
    const parts = partsFor(country);
    const blank = parts.filter((k) => next[k] === "");
    /**
     * Is anything at all filled in?
     *
     * Asked over EVERY part, not just the required ones, because this is what
     * separates "unfinished" from "deliberately removed" — and `next` sends
     * every part regardless of whether the country requires it. Counting only
     * `parts` meant a form holding one OPTIONAL value looked completely empty:
     * an Irish shopper who typed an Eircode and nothing else, or a Singapore
     * shopper who typed a region, hit `blank.length === parts.length`, took the
     * removal branch, and had their address DELETED instead of being told what
     * was missing.
     */
    const anyFilled = PARTS.some((k) => next[k] !== "");

    // All or nothing — see the note at the top of the file.
    if (anyFilled && blank.length > 0) {
      const map: Record<string, string> = {};
      for (const k of blank) map[k] = NEEDED;
      setFields(map);
      setError(
        "Please finish the address — " +
          blank.map((k) => partLabel(k, country)).join(", ") +
          " still to go. Or clear every box to remove the address.",
      );

      return;
    }

    // The name the server demands. It came from the account, so it is almost
    // always there; if it somehow is not, sending our empty one would overwrite
    // theirs, so this stops and points at the screen that owns it.
    const keptName = (profile.name ?? "").trim();
    if (keptName.length < 2) {
      setError("Please add your name in My details first — an address is saved against it.");

      return;
    }

    setBusy(true);
    try {
      const fresh = await updateProfile({
        name: keptName,
        // Resent, NOT omitted: updateProfile() always writes these two, so
        // leaving them out would clear the phone and the date of birth.
        phone: profile.phone,
        dob: profile.dob,
        ...next,
        country,
      });
      fill(fresh);
      setSaved(true);

      // Start the next checkout from the address just saved, so "where your
      // orders are delivered" is true of the basket as well as of the account.
      // Only a complete address is pushed: a cleared one must not wipe a usable
      // delivery draft on the way out.
      if (draftReady && blank.length === 0) {
        setDraft({
          address: fresh.address ?? next.address,
          city: fresh.city ?? next.city,
          state: fresh.state ?? next.state,
          zip: fresh.zip ?? next.zip,
          country: fresh.country ?? country,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const key of [...PARTS, "country"]) {
          const msg = err.fieldError(key);
          if (msg) map[key] = msg;
        }
        setFields(map);

        // A complaint about the name, phone or birthday is not about anything
        // on this screen, so it is shown whole rather than pinned to no field.
        const elsewhere =
          err.fieldError("name") ?? err.fieldError("phone") ?? err.fieldError("dob");
        if (elsewhere) setError(elsewhere);
        else if (Object.keys(map).length === 0) setError(err.message);
      } else {
        setError("That didn’t save. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Saved address" subtitle="Where your orders are delivered.">
        <Empty
          title="Sign in to save an address"
          body="Your delivery address lives with your account, so it is ready at checkout on any device you sign in on."
          action={{ label: "Sign in or join", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  const hasAddress = Boolean(
    profile?.address || profile?.city || profile?.state || profile?.zip,
  );

  return (
    <AccountShell
      title="Saved address"
      subtitle="Where your orders are delivered."
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
      footerSpace={120}
      footer={
        profile ? (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
            <GradientButton
              label={
                busy
                  ? "Saving…"
                  : saved && !dirty
                    ? "Saved"
                    : hasAddress
                      ? "Save address"
                      : "Add address"
              }
              disabled={busy || !dirty}
              onPress={() => void save()}
            />
          </View>
        ) : null
      }
    >
      {profile === null && loadError === null ? <Loading label="Loading your address…" /> : null}

      {loadError && profile === null ? (
        <Failed message={loadError} onRetry={() => void load()} />
      ) : null}

      {profile ? (
        <>
          <SectionLabel>DELIVERY ADDRESS</SectionLabel>
          <Panel>
            {/* The COUNTRY leads, because it decides what the three boxes
                under it are called and whether the fourth exists at all. A
                picker below the fields it relabels makes the form rearrange
                itself after someone has already filled it in. */}
            <CountryField
              account
              value={country}
              onChange={(code) => {
                // A region and a postcode belong to the country they were typed
                // in, so NEITHER survives a change of country — unconditionally,
                // whatever the two countries have in common. This used to clear
                // the region only when the KIND of input changed and the
                // postcode only when the new country had none, which quietly
                // held on to both in the commonest case: a South African address
                // reading "Gauteng" plus a ZA code, switched to GB, kept the lot
                // — `usesStateList("GB") === usesStateList("ZA")` and both
                // countries issue postcodes — and `POST /orders` then went out
                // as { state: "Gauteng", zip: <ZA code>, country: "GB" }, an
                // address no British courier can deliver to. Retyping two boxes
                // is the cheaper mistake.
                setState("");
                setZip("");
                setCountry(code);
              }}
              error={fields.country}
              hint="Sets which delivery rates apply at checkout."
              bottomInset={insets.bottom}
            />

            <Field
              account
              label="Street address"
              value={address}
              onChangeText={setAddress}
              placeholder={
                country === "NG"
                  ? "14 Admiralty Way, Lekki Phase 1"
                  : "Flat, house number and street"
              }
              autoComplete="street-address"
              textContentType="fullStreetAddress"
              error={fields.address}
              style={{ marginTop: 16 }}
            />
            {/* The autofill hints run the length of the address, not just the
                street line. Android reads `autoComplete` and iOS reads
                `textContentType`, so both are given on every box: with the
                street line alone annotated the OS fills it and then stops, and
                the customer types the other three by hand next to a keyboard
                that is still offering to finish them. Same values as the
                checkout form, so one saved OS address fills both. */}
            <Field
              account
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder={country === "NG" ? "Lagos" : "Town or city"}
              autoComplete="postal-address-locality"
              textContentType="addressCity"
              error={fields.city}
              style={{ marginTop: 16 }}
            />

            {/* Picked inside Nigeria, typed everywhere else — and the label is
                the country's own word for it, so a Canadian is not asked for a
                "State" and a Briton not asked for a "Province". */}
            {usesStateList(country) ? (
              <SelectField
                account
                label={regionLabel(country)}
                value={state}
                placeholder={`Select your ${regionLabel(country).toLowerCase()}…`}
                options={regionOptions(country)}
                // Without this the Nigerian picker is a one-way door: a shopper
                // emptying every other box to REMOVE their saved address could
                // not clear the state with them, so the address stayed partly
                // filled and the all-or-nothing guard refused the save with no
                // way to comply.
                clearable
                clearLabel={`No ${regionLabel(country).toLowerCase()}`}
                onChange={setState}
                error={fields.state}
                style={{ marginTop: 16 }}
                bottomInset={insets.bottom}
              />
            ) : (
              <Field
                account
                label={regionLabel(country)}
                value={state}
                onChangeText={setState}
                autoCapitalize="words"
                // Capped at the SHORTER of the two server limits, not the
                // longer. `POST /orders` accepts a 120-character region but
                // `GET /api/shipping/quote` validates the same string as
                // `max:60`, so a 61-to-120-character region 422s the quote for
                // ever while the order itself saves: the delivery row shows "—"
                // and the Pay total quietly leaves delivery out, and the
                // customer is then charged the real fee the server worked out.
                // A silently wrong total is worse than a field that stops
                // accepting characters, so 60 is the limit that must hold.
                maxLength={REGION_MAX}
                autoComplete="postal-address-region"
                textContentType="addressState"
                error={fields.state}
                style={{ marginTop: 16 }}
              />
            )}
            {/* Said once, under the field it is about. Which field that is
                depends on the country: Nigeria prices per state, everywhere
                else the zones are country-level. SelectField has no `hint`. */}
            {fields.state ? null : (
              <Txt tone="faint" size={11} style={{ marginTop: 5 }}>
                {usesStateList(country)
                  ? `Your ${regionLabel(country).toLowerCase()} sets the delivery fee at checkout.`
                  : "Outside Nigeria the delivery fee is set by the country."}
              </Txt>
            )}

            {/* Not shown at all where there is no postal system to ask about —
                an empty box with no possible answer reads as a form you have
                failed to finish. `hasPostcode()`, NOT `postcodeRequired()`:
                this decides whether there is anywhere to put a code, which is a
                softer question than whether we refuse to save without one. The
                gap between the two is Ireland, where an Eircode is real but
                most addresses are still written without it — the box appears,
                and `partsFor()` above leaves `zip` off the list it blocks the
                save on. */}
            {hasPostcode(country) ? (
              <Field
                account
                label={postcodeLabel(country)}
                value={zip}
                onChangeText={setZip}
                placeholder={country === "NG" ? "106104" : undefined}
                // Letters are unreachable on a number pad, and half the world's
                // postcodes contain them — see postcodeKeyboard().
                keyboardType={postcodeKeyboard(country)}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="postal-code"
                textContentType="postalCode"
                error={fields.zip}
                style={{ marginTop: 16 }}
              />
            ) : null}

            <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 13 }}>
              Saved to your account, so it follows you to any device. You can still change
              the address on an individual order.
            </Txt>
          </Panel>

          {/* An empty form deserves a sentence, not silence. */}
          {!hasAddress ? (
            <Txt tone="body" size={11} style={{ marginTop: 14, lineHeight: 17 }}>
              There is no address on your account yet. Add one here and checkout will start
              from it.
            </Txt>
          ) : null}

          <SectionLabel>ALSO ON YOUR ACCOUNT</SectionLabel>
          <Panel padded={false}>
            <Pressable
              onPress={() => router.push("/account/profile")}
              accessibilityRole="button"
              accessibilityLabel="Edit my details"
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Txt tone="strong" weight="medium" size={11}>
                  My details
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 4 }} numberOfLines={1}>
                  {[profile.name, profile.phone].filter(Boolean).join(" · ") ||
                    "Your name, phone and date of birth"}
                </Txt>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          </Panel>

          {error ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          {saved && !dirty ? (
            <Txt tone="body" size={10} center style={{ marginTop: 14 }}>
              {hasAddress ? "Your delivery address is up to date." : "Address removed."}
            </Txt>
          ) : null}
        </>
      ) : null}
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  chevron: { fontFamily: fonts.body, fontSize: 20, color: t.textInk.faint },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: t.surfaces.cart,
  },
});
