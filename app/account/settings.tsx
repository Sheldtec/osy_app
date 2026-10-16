import Constants from "expo-constants";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AccountShell, Empty, Panel, SectionLabel } from "@/components/account-ui";
import { Field } from "@/components/checkout-ui";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import {
  closeAccount,
  getProfile,
  logoutOtherDevices,
  sendEmailVerification,
  type Profile,
} from "@/lib/profile-api";
import type { Theme } from "@/theme/theme";
import { useThemeMode, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Settings — the gear in the My account header.
 *
 * That gear had no `onPress` at all, which makes four dead controls found in
 * this one screen's history (the hamburger, the wishlist heart, the Help
 * centre row, and this).
 *
 * It gathers the things that are ABOUT the account rather than part of
 * shopping: where preferences live, how to secure the session, and how to
 * leave. Deliberately NOT a second copy of the account rows — every entry here
 * either does something no row does, or is the natural place somebody would
 * look for it under a gear.
 *
 * Two destructive actions, both two-step:
 *   · Signing out other devices is recoverable (sign in again), so it confirms
 *     inline and reports how many sessions ended.
 *   · Closing the account is not. It asks for proof — a password, or the email
 *     typed back for an account made through Google or Apple, which is what
 *     the server will check.
 */

export default function SettingsScreen() {
  const s = useThemedStyles(makeS);
  const { signedIn, signOut, user } = useAuth();
  const { code: currency } = useCurrency();
  const { mode, resolved } = useThemeMode();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const [proof, setProof] = useState("");
  const [proofError, setProofError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile(await getProfile());
    } catch {
      // Not fatal — the screen's own actions still work; only the "how you
      // signed up" copy and the close-account prompt need it.
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  async function endOtherSessions() {
    setConfirmingSignOut(false);
    setNotice(null);
    setError(null);
    setBusy("devices");
    try {
      const res = await logoutOtherDevices();
      setNotice(
        res.revoked > 0
          ? `${res.revoked} other ${res.revoked === 1 ? "device was" : "devices were"} signed out.`
          : "There were no other devices signed in.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn’t work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function resendConfirmation() {
    setNotice(null);
    setError(null);
    setBusy("email");
    try {
      // The server says whether there was anything to send — it knows, and
      // this screen does not.
      const res = await sendEmailVerification();
      setNotice(res.message);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We couldn’t send that just now.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function confirmClose() {
    setProofError(null);

    const needsPassword = profile?.has_password ?? true;
    if (!proof.trim()) {
      setProofError(needsPassword ? "Enter your password to confirm." : "Enter your email to confirm.");

      return;
    }

    setBusy("close");
    try {
      await closeAccount(needsPassword ? { password: proof } : { email: proof });
      // Every token is gone server-side; drop the local session too so the app
      // is not holding one it cannot use.
      await signOut();
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setProofError(err.fieldError("password") ?? err.fieldError("email") ?? err.message);
      } else {
        setProofError("That didn’t go through. Please try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Settings" subtitle="Preferences, security and your account.">
        <Empty
          title="Sign in first"
          body="These settings belong to an account, so you'll need to be signed in to change them."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  const needsPassword = profile?.has_password ?? true;
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <AccountShell title="Settings" subtitle={user?.email ?? "Preferences, security and your account."}>
      {/* ---------------- preferences ---------------- */}
      <SectionLabel>PREFERENCES</SectionLabel>
      <Panel padded={false}>
        <Row
          label="Currency"
          sub={`Prices are shown in ${currency}`}
          onPress={() => router.push("/account/currency")}
        />
        <Row
          label="Notifications"
          sub="What we send, and how"
          onPress={() => router.push("/account/notifications")}
        />
        <Row
          label="Appearance"
          sub={appearanceSub(mode, resolved)}
          onPress={() => router.push("/account/appearance")}
          last
        />
      </Panel>

      {/* ---------------- security ---------------- */}
      <SectionLabel>SECURITY</SectionLabel>
      <Panel padded={false}>
        <Row
          label={needsPassword ? "Change password" : "Set a password"}
          sub={
            needsPassword
              ? "Also signs out your other devices"
              : `You signed up with ${profile?.provider ?? "a social account"}`
          }
          onPress={() => router.push("/account/password")}
        />

        <View style={s.action}>
          <View style={{ flex: 1 }}>
            <Txt tone="strong" weight="medium" size={11}>
              Sign out other devices
            </Txt>
            <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
              Keeps you signed in here and ends every other session.
            </Txt>
          </View>

          {confirmingSignOut ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable
                onPress={() => setConfirmingSignOut(false)}
                accessibilityRole="button"
                style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.pillText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void endOtherSessions()}
                accessibilityRole="button"
                accessibilityLabel="Confirm signing out other devices"
                style={({ pressed }) => [s.pill, s.pillStrong, pressed && { opacity: 0.7 }]}
              >
                <Text style={[s.pillText, { color: "#FFFFFF" }]}>Sign out</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setConfirmingSignOut(true)}
              disabled={busy === "devices"}
              accessibilityRole="button"
              style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.pillText}>{busy === "devices" ? "Working…" : "Sign out"}</Text>
            </Pressable>
          )}
        </View>
      </Panel>

      {/* ---------------- the account itself ---------------- */}
      <SectionLabel>YOUR ACCOUNT</SectionLabel>
      <Panel padded={false}>
        <View style={s.action}>
          <View style={{ flex: 1 }}>
            <Txt tone="strong" weight="medium" size={11}>
              Confirm your email
            </Txt>
            <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
              Needed before store credit can be claimed.
            </Txt>
          </View>
          <Pressable
            onPress={() => void resendConfirmation()}
            disabled={busy === "email"}
            accessibilityRole="button"
            accessibilityLabel="Send a confirmation email"
            style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.pillText}>{busy === "email" ? "Sending…" : "Send"}</Text>
          </Pressable>
        </View>

        <Row label="My details" sub="Name, phone, birthday and address" onPress={() => router.push("/account/profile")} last />
      </Panel>

      {notice ? (
        <Panel style={{ marginTop: 16 }}>
          <Txt tone="body" size={11} style={{ lineHeight: 16 }}>
            {notice}
          </Txt>
        </Panel>
      ) : null}

      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
          {error}
        </Txt>
      ) : null}

      {/* ---------------- legal ---------------- */}
      <SectionLabel>LEGAL</SectionLabel>
      <Panel padded={false}>
        {/* The params form, not a literal path: typedRoutes is on, so a
            dynamic segment has to be named rather than interpolated. */}
        <Row
          label="Terms & conditions"
          onPress={() => router.push({ pathname: "/account/legal/[slug]", params: { slug: "terms" } })}
        />
        <Row
          label="Privacy policy"
          onPress={() => router.push({ pathname: "/account/legal/[slug]", params: { slug: "privacy" } })}
        />
        <Row
          label="Returns & refunds"
          onPress={() => router.push({ pathname: "/account/legal/[slug]", params: { slug: "returns" } })}
          last
        />
      </Panel>

      {/* ---------------- leaving ---------------- */}
      <SectionLabel>CLOSE ACCOUNT</SectionLabel>
      <Panel>
        <Txt tone="body" size={10} style={{ lineHeight: 15 }}>
          Closing your account signs you out everywhere and removes it. Store credit, saved pieces
          and order history go with it, and we can’t bring them back.
        </Txt>

        {closing ? (
          <>
            <Field
              account
              label={needsPassword ? "Your password" : "Your email"}
              value={proof}
              onChangeText={setProof}
              placeholder={needsPassword ? "To confirm it's you" : user?.email ?? "you@email.com"}
              secureTextEntry={needsPassword}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={needsPassword ? "default" : "email-address"}
              error={proofError ?? undefined}
              style={{ marginTop: 16 }}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  setClosing(false);
                  setProof("");
                  setProofError(null);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [s.wide, pressed && { opacity: 0.75 }]}
              >
                <Text style={s.pillText}>Keep my account</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmClose()}
                disabled={busy === "close"}
                accessibilityRole="button"
                accessibilityLabel="Permanently close my account"
                style={({ pressed }) => [s.wide, s.wideDanger, pressed && { opacity: 0.75 }]}
              >
                <Text style={[s.pillText, { color: "#FFFFFF" }]}>
                  {busy === "close" ? "Closing…" : "Close it"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            onPress={() => setClosing(true)}
            accessibilityRole="button"
            style={({ pressed }) => [s.closeLink, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.closeLinkText}>Close my account</Text>
          </Pressable>
        )}
      </Panel>

      <Text style={s.version}>OsyGentle for {Constants.platform?.ios ? "iOS" : "Android"} · v{version}</Text>
    </AccountShell>
  );
}

/** "Light" / "Dark" / "Following your phone · dark". */
function appearanceSub(mode: string, resolved: string): string {
  if (mode === "system") return `Following your phone · ${resolved}`;

  return mode === "dark" ? "Dark" : "Light";
}

function Row({
  label,
  sub,
  onPress,
  last,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const s = useThemedStyles(makeS);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Txt tone="strong" weight="medium" size={11}>
          {label}
        </Txt>
        {sub ? (
          <Txt tone="body" size={9} style={{ marginTop: 4 }}>
            {sub}
          </Txt>
        ) : null}
      </View>
      <Text style={s.chevron}>›</Text>
      {!last ? <View style={s.divider} /> : null}
    </Pressable>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  divider: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.lineSoft,
  },
  chevron: { fontFamily: fonts.body, fontSize: 20, color: t.textInk.faint },

  pill: {
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  pillStrong: { backgroundColor: t.colors.primary },
  pillText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  wide: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  wideDanger: { backgroundColor: t.colors.danger },

  closeLink: { marginTop: 14, alignSelf: "flex-start", paddingVertical: 6 },
  closeLinkText: { fontFamily: fonts.medium, fontSize: 11.5, color: t.colors.danger },

  version: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: t.textInk.faint,
    textAlign: "center",
    marginTop: 22,
  },
});
