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
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { STATE_OPTIONS } from "@/lib/geo";
import { ApiError } from "@/lib/http";
import { getProfile, updateProfile, type Profile } from "@/lib/profile-api";
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
 * Two things here are not cosmetic:
 *
 *  · The date of birth drives the birthday-month free-delivery perk, and it is
 *    part of the completed-profile gate on the ₦17,000 welcome credit. So the
 *    screen says what it is FOR rather than asking for it blankly.
 *  · The address block is the DEFAULT delivery address, held server-side, and
 *    the same completeness gate checks it. Sending an emptied box as null is
 *    deliberate (see `updateProfile`): clearing a field here really removes it.
 */

/** `YYYY-MM-DD`, the only shape the API accepts. */
const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function ProfileScreen() {
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn, user } = useAuth();

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

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const fill = useCallback((p: Profile) => {
    setProfile(p);
    setName(p.name ?? "");
    setPhone(p.phone ?? "");
    setDob(p.dob ?? "");
    setAddress(p.address ?? "");
    setCity(p.city ?? "");
    setState(p.state ?? "");
    setZip(p.zip ?? "");
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

  /** Anything the shopper has altered since the last successful save. */
  const dirty = useMemo(() => {
    if (!profile) return false;

    return (
      name.trim() !== (profile.name ?? "") ||
      phone.trim() !== (profile.phone ?? "") ||
      dob.trim() !== (profile.dob ?? "") ||
      address.trim() !== (profile.address ?? "") ||
      city.trim() !== (profile.city ?? "") ||
      state.trim() !== (profile.state ?? "") ||
      zip.trim() !== (profile.zip ?? "")
    );
  }, [profile, name, phone, dob, address, city, state, zip]);

  async function save() {
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

    setBusy(true);
    try {
      const next = await updateProfile({
        name,
        phone,
        dob,
        address,
        city,
        state,
        zip,
        // The shop is Lagos-based and checkout defaults the same way; the
        // server only accepts a 2-letter code.
        country: profile?.country ?? "NG",
      });
      fill(next);
      setSaved(true);
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

            <Field
              account
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="+234 800 000 0000"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              hint="Our rider calls this number on the day."
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
            <Field
              account
              label="Street address"
              value={address}
              onChangeText={setAddress}
              placeholder="14 Admiralty Way, Lekki Phase 1"
              autoComplete="street-address"
              error={fields.address}
            />
            <Field
              account
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder="Lagos"
              error={fields.city}
              style={{ marginTop: 16 }}
            />
            <SelectField
              account
              label="State"
              value={state}
              placeholder="Select your state…"
              options={STATE_OPTIONS}
              onChange={setState}
              error={fields.state}
              style={{ marginTop: 16 }}
              bottomInset={insets.bottom}
            />
            <Field
              account
              label="Postcode"
              value={zip}
              onChangeText={setZip}
              placeholder="106104"
              keyboardType="number-pad"
              error={fields.zip}
              style={{ marginTop: 16 }}
            />

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

const makeS = (t: Theme) => StyleSheet.create({
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
