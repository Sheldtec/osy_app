import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
import { IconEdit } from "@/components/icons";
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
import { getProfile, updateProfile, uploadAvatar, type Profile } from "@/lib/profile-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * My details — the account's own edit screen.
 *
 * The app had no way to change a name, a phone number, a date of birth or the
 * default delivery address. The API has had `PATCH /auth/profile` all along;
 * only the screen was missing, so a shopper who mistyped their phone at signup
 * could not correct it anywhere in the app.
 *
 * Four things here are not cosmetic:
 *
 *  · The date of birth drives the birthday-month free-delivery perk, and it is
 *    part of the completed-profile gate on the ₦17,000 welcome credit. So the
 *    screen says what it is FOR rather than asking for it blankly.
 *  · The address block is the DEFAULT delivery address, held server-side, and
 *    the same completeness gate checks it. Sending an emptied box as null is
 *    deliberate (see `updateProfile`): clearing a field here really removes it.
 *  · That address block is INTERNATIONAL. It used to be Nigeria in disguise —
 *    a "State" picker holding Nigeria's 37, a "Postcode" box every shopper had
 *    to fill, and a country silently resent as whatever was already stored (so
 *    nobody could ever set one). The country now leads the block and decides
 *    the rest: what the region is called and whether it is picked or typed
 *    (only Nigeria's shipping zones match on the region string — see
 *    lib/geo.ts), and whether a postcode exists to ask for at all. This block
 *    writes the same five columns as `account/address.tsx` through the same
 *    `updateProfile()`, so its labels, placeholders and order are deliberately
 *    identical to that screen's: the two must not read as two different forms.
 *  · The address block is ALL OR NOTHING, and it HANDS OVER TO CHECKOUT.
 *    Both rules are taken from `account/address.tsx`, the screen that exists to
 *    own this address, because a shopper may edit it from either and the two
 *    must agree on what a finished address is. A three-quarters-filled address
 *    used to save here without complaint and then block the basket at a screen
 *    that could not explain itself — and worse, the other screen would not save
 *    it either, so an address left a box short here could no longer be
 *    corrected where it belongs. The copy under the block, meanwhile, has
 *    always promised "Checkout starts from this address" while nothing pushed
 *    it there: a shopper in Accra who set Ghana here opened the bag to a blank
 *    form with Nigeria selected and a postcode demanded. A complete save now
 *    seeds the delivery draft, and a cleared address leaves a usable draft
 *    alone.
 *
 * The PHOTO at the top is its own save. It uploads the moment a picture is
 * chosen rather than waiting for "Save changes", because the two have nothing
 * to do with each other — `POST /auth/avatar` is a separate endpoint, and
 * holding a photo hostage to the form would mean an invalid date of birth
 * could block it.
 */

/** `YYYY-MM-DD`, the only shape the API accepts. */
const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The parts of an address the checkout cannot price an order without.
 *
 * Held here as well as in `account/address.tsx` on purpose. The two screens
 * write the same five columns through the same `updateProfile()`, so whatever
 * one of them accepts as a finished address the other has to accept as well:
 * the day they disagree is the day an address saved on one cannot be edited on
 * the other.
 */
const PARTS = ["address", "city", "state", "zip"] as const;

type Part = (typeof PARTS)[number];

/**
 * The parts THIS country actually has.
 *
 * A part is only MISSING where the country has one to give. Around a third of
 * the countries we ship to issue no postcode at all (`postcodeRequired()`), and
 * a city-state has no region to name (`regionRequired()`) — an empty box there
 * is not an unfinished field, it is a field with no answer, and blocking the
 * save on it would make the screen impossible to finish in Accra or Singapore.
 *
 * Deliberately the same two predicates as `requiredFor()` in lib/checkout.tsx,
 * so an address this screen calls finished is one the basket can price. Note
 * the asymmetry with the postcode box below, which asks `hasPostcode()`:
 * Ireland is shown a box it is not required to fill.
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

export default function ProfileScreen() {
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn, user } = useAuth();
  const { set: setDraft, ready: draftReady } = useCheckout();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);

  const fill = useCallback((p: Profile) => {
    setProfile(p);
    setName(p.name ?? "");
    setPhone(p.phone ?? "");
    setDob(p.dob ?? "");
    setAddress(p.address ?? "");
    setCity(p.city ?? "");
    // Clamped on LOAD as well as on save: these columns are also written by
    // the website, where the same box accepted 120 characters, and a value
    // over 60 makes every shipping quote 422 for ever (see REGION_MAX).
    setState(clampRegion(p.state));
    setZip(p.zip ?? "");
    // An account holding an unrecognised code keeps it: `normalizeCountry`
    // fills in the blank, it does not rewrite a country it cannot name.
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
          err instanceof ApiError ? err.message : "We couldn’t load your details.",
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
   * The postcode as the save will send it: kept where the country has one to
   * hold — `hasPostcode()`, so an Eircode typed into Dublin’s visible, optional
   * box survives rather than being thrown away for not having been compulsory
   * — and dropped where there is no postal system for it to belong to. Read by
   * `dirty` as well as by the save, so the button and the request can never
   * disagree about whether there is anything left to change.
   */
  const effectiveZip = useMemo(
    () => (hasPostcode(country) ? zip.trim() : ""),
    [country, zip],
  );

  /**
   * Anything the save would actually CHANGE — which is not the same thing as
   * anything the shopper has typed.
   *
   * The postcode is why it has to be put that way. A profile written on the
   * website can hold a country with no postal system and a code anyway — GH
   * plus "00233" — and the save strips that orphan out. Comparing the raw box
   * against the stored value never noticed: the two are equal on load, the box
   * is not even rendered, so Save stayed disabled and the one screen that could
   * have cleared the code could never be used to do it.
   */
  const dirty = useMemo(() => {
    if (!profile) return false;

    return (
      name.trim() !== (profile.name ?? "") ||
      phone.trim() !== (profile.phone ?? "") ||
      dob.trim() !== (profile.dob ?? "") ||
      address.trim() !== (profile.address ?? "") ||
      city.trim() !== (profile.city ?? "") ||
      state.trim() !== (profile.state ?? "") ||
      effectiveZip !== (profile.zip ?? "") ||
      country !== normalizeCountry(profile.country)
    );
  }, [profile, name, phone, dob, address, city, state, effectiveZip, country]);

  /**
   * The photo on screen. `profile.avatar` is the fresher of the two — the auth
   * context's copy is whatever was cached at sign-in, so it lags a change made
   * here until that context is refreshed.
   */
  const avatar = profile?.avatar ?? user?.avatar ?? null;
  const initial = (profile?.name ?? user?.name ?? "").trim().charAt(0).toUpperCase();

  /**
   * Choose a photo and send it.
   *
   * Square-cropped in the picker because that is how it is drawn everywhere —
   * letting someone pick a landscape shot and then centre-cropping it behind
   * their back is how a face ends up out of frame.
   */
  async function pickAvatar(from: "camera" | "library") {
    setPhotoError(null);
    setPhotoSaved(false);

    const permission =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setPhotoError(
        from === "camera"
          ? "We need camera access to take your photo. You can allow it in your phone’s Settings."
          : "We need photo access to use a picture you already have. You can allow it in your phone’s Settings.",
      );

      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    };

    const res =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (res.canceled || !res.assets?.length) return;

    const shot = res.assets[0];

    setUploading(true);
    try {
      // Only the profile object is replaced, never the form boxes: someone
      // halfway through correcting their phone number must not lose it to a
      // photo upload.
      setProfile(await uploadAvatar({ uri: shot.uri, width: shot.width, height: shot.height }));
      setPhotoSaved(true);
    } catch (err) {
      setPhotoError(
        err instanceof ApiError
          ? (err.fieldError("photo") ?? err.message)
          : "That photo didn’t save. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    // The button that calls this only exists once the profile has loaded, and
    // everything below compares against it.
    if (!profile) return;

    setError(null);
    setFields({});
    setSaved(false);

    // Cheap local checks, so the obvious mistakes never leave the phone.
    if (name.trim().length < 2) {
      setFields({ name: "Please enter your name." });

      return;
    }
    if (dob.trim() && !DOB_PATTERN.test(dob.trim())) {
      setFields({ dob: "Use the format YYYY-MM-DD, for example 1996-04-21." });

      return;
    }

    const next = {
      address: address.trim(),
      city: city.trim(),
      state: clampRegion(state),
      // Already stripped where the country has no postal system to hold it —
      // see `effectiveZip`. A code left over from the previous country, or one
      // the account arrived carrying, would otherwise travel to the courier
      // without ever being shown to the customer again.
      zip: effectiveZip,
    };
    // Not PARTS: an address has as many parts as its country gives it — three
    // where no postcode is issued, three in a city-state with no region.
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

    /**
     * Whether the ADDRESS is part of what is being saved, as opposed to the
     * name, the phone or the birthday.
     *
     * It decides whether the checkout draft is reseeded below. On
     * `account/address.tsx` the question does not arise — there is nothing else
     * on that screen to save — but here a shopper correcting a mistyped phone
     * number must not have the one-off address they typed into the basket
     * quietly replaced by their default, because the line under the block
     * promises they can still change it on any order.
     */
    const addressChanged =
      next.address !== (profile.address ?? "") ||
      next.city !== (profile.city ?? "") ||
      next.state !== (profile.state ?? "") ||
      next.zip !== (profile.zip ?? "") ||
      country !== normalizeCountry(profile.country);

    // ALL OR NOTHING. A partial address saves here without a word and then
    // costs the shopper the basket, because `requiredFor()` in lib/checkout.tsx
    // will not price an order without these parts — and it cannot be repaired
    // on `account/address.tsx` either, which runs this same check, finds the
    // address one box short and declines to save it. A street and city stored
    // here with the postcode left out therefore locked the address out of the
    // screen that owns it. This is where that hole was dug, so this is where it
    // is refused. Emptying every box still genuinely removes the address.
    if (anyFilled && blank.length > 0) {
      const map: Record<string, string> = {};
      for (const k of blank) map[k] = NEEDED;
      setFields(map);
      setError(
        "Please finish the address — " +
          blank.map((k) => partLabel(k, country)).join(", ") +
          " still to go. Or clear every box to remove the address. " +
          // Said here and not on `account/address.tsx`, because only this
          // screen has a name, a phone and a birthday waiting behind the same
          // button: nothing at all was sent, and being told so is the
          // difference between a form that is explaining itself and one that
          // looks like it has swallowed the edit.
          "Nothing else was saved either — your other changes are still here.",
      );

      return;
    }

    setBusy(true);
    try {
      const fresh = await updateProfile({
        name,
        phone,
        dob,
        ...next,
        country,
      });
      fill(fresh);
      setSaved(true);

      // The line under the block says checkout starts from this address, so it
      // has to. Only a COMPLETE address is pushed, and only when the address is
      // what changed: someone who has just emptied every box has removed their
      // default rather than asked us to wipe an address they may be part-way
      // through typing into the basket, and someone who came here to fix a
      // phone number has not asked us to touch the basket at all.
      if (draftReady && addressChanged && blank.length === 0) {
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
        for (const key of ["name", "phone", "dob", "address", "city", "state", "zip", "country"]) {
          const msg = err.fieldError(key);
          if (msg) map[key] = msg;
        }
        setFields(map);
        if (Object.keys(map).length === 0) setError(err.message);
      } else {
        setError("That didn’t save. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="My details" subtitle="Your name, contact and delivery address.">
        <Empty
          title="Sign in to see your details"
          body="Your profile lives with your account, so it follows you to any device you sign in on."
          action={{ label: "Sign in or join", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="My details"
      subtitle={profile?.email ?? "Your name, contact and delivery address."}
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
              label={busy ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
              disabled={busy || !dirty}
              onPress={() => void save()}
            />
          </View>
        ) : null
      }
    >
      {profile === null && loadError === null ? <Loading label="Loading your details…" /> : null}

      {loadError && profile === null ? (
        <Failed message={loadError} onRetry={() => void load()} />
      ) : null}

      {profile ? (
        <>
          <SectionLabel>YOUR PHOTO</SectionLabel>
          <Panel>
            <View style={s.photoRow}>
              <Pressable
                onPress={() => void pickAvatar("library")}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel={
                  avatar ? "Change your profile photo" : "Add a profile photo"
                }
                accessibilityState={{ busy: uploading }}
                hitSlop={6}
                style={({ pressed }) => [s.avatarTap, pressed && { opacity: 0.8 }]}
              >
                <View style={s.avatar}>
                  {avatar ? (
                    <Image
                      source={{ uri: avatar }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={160}
                    />
                  ) : (
                    <Text style={s.avatarInitial}>{initial || "·"}</Text>
                  )}

                  {uploading ? (
                    <>
                      <View style={s.avatarScrim} />
                      <View style={s.avatarBusy}>
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      </View>
                    </>
                  ) : null}
                </View>

                {/* The affordance. Without it a photo that happens to be there
                    looks like decoration rather than something you can change. */}
                <View style={s.avatarBadge}>
                  <IconEdit width={13} height={13} />
                </View>
              </Pressable>

              <View style={{ flex: 1, marginLeft: 16 }}>
                <Txt tone="strong" weight="medium" size={11}>
                  {uploading
                    ? "Uploading your photo…"
                    : avatar
                      ? "Tap your photo to change it"
                      : "Add a photo of yourself"}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 5, lineHeight: 13 }}>
                  A JPG or PNG, up to 5 MB. We shrink it on this phone before it is sent.
                </Txt>

                <View style={s.photoActions}>
                  <PhotoAction
                    label="Choose photo"
                    disabled={uploading}
                    onPress={() => void pickAvatar("library")}
                  />
                  <PhotoAction
                    label="Take one"
                    disabled={uploading}
                    onPress={() => void pickAvatar("camera")}
                  />
                </View>
              </View>
            </View>

            {photoError ? (
              <Txt tone="danger" size={10} style={{ marginTop: 14, lineHeight: 15 }}>
                {photoError}
              </Txt>
            ) : null}

            {photoSaved && !photoError ? (
              <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 13 }}>
                Saved. It may take a moment to appear on your other screens.
              </Txt>
            ) : null}
          </Panel>

          <SectionLabel>ABOUT YOU</SectionLabel>
          <Panel>
            <Field
              account
              label="Full name"
              value={name}
              onChangeText={setName}
              placeholder="Ama Mensah"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              error={fields.name}
            />

            {/* The email is the account's identity and is not editable here;
                changing it needs re-verification, which this screen does not
                do. Shown so the shopper can see which account they are in. */}
            <View style={s.readOnly}>
              <Text style={s.readOnlyLabel}>EMAIL</Text>
              <Txt tone="strong" size={13} style={{ marginTop: 6 }}>
                {profile.email}
              </Txt>
              <Txt tone="body" size={9} style={{ marginTop: 5, lineHeight: 13 }}>
                Contact us if you need to change the address your account uses.
              </Txt>
            </View>

            {/* A Nigerian sample number is a helpful example in Lagos and a
                misleading one anywhere else — it reads as the shop asking for a
                Nigerian line — and our own rider is not who knocks on a door in
                London. Both follow the delivery country below, the same way the
                checkout’s phone field follows the draft’s. */}
            <Field
              account
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder={
                country === "NG" ? "+234 800 000 0000" : "Include your country code"
              }
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              hint={
                country === "NG"
                  ? "Our rider calls this number on the day."
                  : "Whoever delivers your order calls this number."
              }
              error={fields.phone}
              style={{ marginTop: 16 }}
            />

            <Field
              account
              label="Date of birth"
              value={dob}
              onChangeText={setDob}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              maxLength={10}
              hint="Delivery is free during your birthday month."
              error={fields.dob}
              style={{ marginTop: 16 }}
            />
          </Panel>

          <SectionLabel>DEFAULT DELIVERY ADDRESS</SectionLabel>
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
                // whatever the two countries happen to have in common. This used
                // to clear the region only when the KIND of input changed and the
                // postcode only when the new country had none, which quietly kept
                // both in the commonest case of all: a South African address
                // reading "Gauteng" with a ZA code, switched to GB, held on to the
                // lot — `usesStateList("GB") === usesStateList("ZA")` and both
                // countries issue postcodes — and the account, and the checkout
                // draft seeded from it, then carried { state: "Gauteng", zip: <ZA
                // code>, country: "GB" }: an address no British courier can
                // deliver to. Retyping two boxes is the cheaper mistake.
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
                street line alone annotated the OS filled it and then stopped,
                and the customer typed the other three by hand next to a
                keyboard that was still offering to finish them. Same values as
                the checkout form, so one saved OS address fills both. */}
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
                // Capped at the SHORTER of the two server limits rather than
                // the longer one. `POST /orders` accepts a 120-character
                // region, but `GET /api/shipping/quote` validates the same
                // string as `max:60`, so a region between the two lengths 422s
                // the quote for ever while the order itself saves: the delivery
                // row shows "—", the Pay total quietly leaves delivery out, and
                // the customer is charged the real fee the server worked out. A
                // silently wrong total is worse than a box that stops taking
                // characters, so 60 is the limit that has to hold.
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
                this decides whether there is anywhere to PUT a code, which is a
                softer question than whether we refuse to save without one. The
                gap between the two is Ireland, where an Eircode is real but
                most addresses are still written without it — the box appears,
                and `partsFor()` above leaves `zip` off the list the save is
                blocked on. */}
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
              Checkout starts from this address. You can still change it on any order.
            </Txt>
          </Panel>

          {/* The profile gate on the welcome credit, stated rather than hidden. */}
          {!profile.profile_complete && profile.profile_todo.length ? (
            <>
              <SectionLabel>STILL TO ADD</SectionLabel>
              <Panel>
                {profile.profile_todo.map((t) => (
                  <Txt key={t.key} tone="body" size={11} style={{ lineHeight: 18 }}>
                    · {t.label}
                  </Txt>
                ))}
              </Panel>
            </>
          ) : null}

          <SectionLabel>SECURITY</SectionLabel>
          <Panel padded={false}>
            <Pressable
              onPress={() => router.push("/account/password")}
              accessibilityRole="button"
              accessibilityLabel={
                profile.has_password ? "Change your password" : "Set a password"
              }
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Txt tone="strong" weight="medium" size={11}>
                  {profile.has_password ? "Change password" : "Set a password"}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                  {profile.has_password
                    ? "Signs out your other devices"
                    : `You signed up with ${profile.provider ?? "a social account"}`}
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
              Your details are up to date.
            </Txt>
          ) : null}
        </>
      ) : null}
    </AccountShell>
  );
}

/**
 * One of the two photo buttons.
 *
 * The same small pill the try-on studio uses for "Take a photo / Choose one" —
 * the two screens are doing the same job and should not look like two
 * different ideas about how to ask for a picture.
 */
function PhotoAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeS);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        s.photoAction,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={s.photoActionText}>{label}</Text>
    </Pressable>
  );
}

const AVATAR = 76;

const makeS = (t: Theme) => StyleSheet.create({
  photoRow: { flexDirection: "row", alignItems: "center" },
  // The badge hangs off the circle, so the press target cannot be the clipped
  // circle itself.
  avatarTap: { width: AVATAR, height: AVATAR },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontFamily: fonts.display, fontSize: 30, color: t.colors.primaryOn },
  // A scrim rather than a replacement: the old photo stays visible underneath,
  // so it is clear WHICH picture is being changed. Opacity sits on this view
  // alone — on the parent it would fade the spinner too.
  avatarScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.colors.night,
    opacity: 0.45,
  },
  avatarBusy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    // Cuts the badge out of the photo behind it at any tone.
    borderWidth: 2,
    borderColor: t.colors.surface,
  },

  photoActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  photoAction: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  photoActionText: { fontFamily: fonts.medium, fontSize: 10.5, color: t.colors.primaryOn },

  readOnly: {
    marginTop: 16,
    backgroundColor: t.surfaces.cart,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  readOnlyLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.body,
  },

  row: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  chevron: { fontFamily: fonts.body, fontSize: 20, color: t.textInk.faint },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: t.surfaces.cart,
  },
});
