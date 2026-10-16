import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountShell, Empty, Failed, Loading, Panel, SectionLabel } from "@/components/account-ui";
import { Field } from "@/components/checkout-ui";
import { IconEye } from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getProfile, updatePassword, type Profile } from "@/lib/profile-api";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Change (or set) the account password.
 *
 * Two cases, and the difference is the server's, not a preference:
 *
 *  · An account with a password must prove the CURRENT one. The server checks
 *    it with `Hash::check` and answers 422 on `current_password` if it is
 *    wrong.
 *  · An account created through Google or Apple has `password === null`, and
 *    the server does NOT ask for a current password — it cannot, there isn't
 *    one. Demanding it would make the screen impossible to complete, so the
 *    field is not rendered at all in that case. `has_password` from
 *    `GET /auth/me` is what decides.
 *
 * Succeeding revokes every OTHER token on the account, so the shopper's other
 * devices are signed out. That is deliberate — a changed password should end
 * sessions a thief might hold — but it is stated up front, because finding
 * yourself signed out of your tablet with no explanation reads as a breach.
 *
 * The policy mirrored here is the server's own, minus `uncompromised()`: that
 * rule is applied at REGISTRATION but not on this endpoint, so a password
 * accepted here is not breach-checked and the screen must not claim it is.
 */
const PASSWORD_RULES = [
  { id: "len", label: "At least 10 characters", test: (v: string) => v.length >= 10 },
  {
    id: "case",
    label: "Upper & lower case",
    test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  { id: "num", label: "A number", test: (v: string) => /\d/.test(v) },
  { id: "sym", label: "A symbol", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export default function PasswordScreen() {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProfile(await getProfile());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "We couldn’t load your account.");
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const checks = useMemo(
    () => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(next) })),
    [next],
  );
  const strong = checks.every((c) => c.ok);
  const matches = confirm.length > 0 && confirm === next;
  const needsCurrent = profile?.has_password ?? true;

  async function submit() {
    setError(null);
    setFields({});

    if (needsCurrent && !current) {
      setFields({ current_password: "Please enter your current password." });

      return;
    }
    if (!strong) {
      setFields({ password: "Please meet all the requirements below." });

      return;
    }
    if (!matches) {
      setFields({ confirm: "The passwords do not match." });

      return;
    }

    setBusy(true);
    try {
      await updatePassword({
        ...(needsCurrent ? { currentPassword: current } : {}),
        password: next,
        passwordConfirmation: confirm,
      });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      // `has_password` is now true even for an account that had none.
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const key of ["current_password", "password"]) {
          const msg = err.fieldError(key);
          if (msg) map[key] = msg;
        }
        setFields(map);
        if (Object.keys(map).length === 0) setError(err.message);
      } else {
        setError("That didn’t go through. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Password" subtitle="Keep your account yours.">
        <Empty
          title="Sign in first"
          body="You need to be signed in to change the password on an account."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  const eye = (
    <Pressable
      onPress={() => setReveal((v) => !v)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={reveal ? "Hide passwords" : "Show passwords"}
    >
      <IconEye width={20} height={20} style={{ opacity: reveal ? 1 : 0.5 }} />
    </Pressable>
  );

  return (
    <AccountShell
      title={needsCurrent ? "Change password" : "Set a password"}
      subtitle={
        needsCurrent
          ? "You’ll stay signed in here; other devices won’t."
          : `You signed up with ${profile?.provider ?? "a social account"}. Adding a password gives you a second way in.`
      }
      footerSpace={120}
      footer={
        profile ? (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
            <GradientButton
              label={busy ? "Saving…" : needsCurrent ? "Change password" : "Set password"}
              disabled={busy}
              onPress={() => void submit()}
            />
          </View>
        ) : null
      }
    >
      {profile === null && loadError === null ? <Loading label="Loading…" /> : null}
      {loadError && profile === null ? <Failed message={loadError} onRetry={() => void load()} /> : null}

      {profile ? (
        <>
          {done ? (
            <Panel style={{ backgroundColor: theme.colors.successBg }}>
              <Txt tone="strong" weight="medium" size={12}>
                Password updated
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                Any other device signed in to this account has been signed out. You’re still
                signed in here.
              </Txt>
            </Panel>
          ) : null}

          {needsCurrent ? (
            <>
              <SectionLabel>CURRENT PASSWORD</SectionLabel>
              <Panel>
                <Field
                  account
                  label="Current password"
                  value={current}
                  onChangeText={setCurrent}
                  placeholder="Your password now"
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  error={fields.current_password}
                  trailing={eye}
                />
              </Panel>
            </>
          ) : null}

          <SectionLabel>{needsCurrent ? "NEW PASSWORD" : "CHOOSE A PASSWORD"}</SectionLabel>
          <Panel>
            <Field
              account
              label="New password"
              value={next}
              onChangeText={setNext}
              placeholder="Create a password"
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 10; required: lower; required: upper; required: digit; required: special;"
              error={fields.password}
              trailing={needsCurrent ? undefined : eye}
            />

            {next.length > 0 ? (
              <View style={s.checks}>
                {checks.map((c) => (
                  <View
                    key={c.id}
                    style={s.check}
                    accessibilityLabel={`${c.label}: ${c.ok ? "met" : "not met"}`}
                  >
                    <View style={[s.dot, c.ok && { backgroundColor: theme.colors.success }]}>
                      <Text style={[s.glyph, c.ok && { color: "#FFFFFF" }]}>
                        {c.ok ? "✓" : "•"}
                      </Text>
                    </View>
                    <Text style={[s.checkLabel, c.ok && { color: theme.colors.success }]}>{c.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Field
              account
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Re-enter it"
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              error={
                fields.confirm ??
                (confirm.length > 0 && !matches ? "The passwords do not match." : undefined)
              }
              style={{ marginTop: 16 }}
            />
          </Panel>

          {error ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          <Txt tone="body" size={9} style={{ marginTop: 16, lineHeight: 14 }}>
            Changing your password signs out every other device on this account. This one stays
            signed in.
          </Txt>
        </>
      ) : null}
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  checks: { marginTop: 14, gap: 8 },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.surfaces.lineSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: { fontFamily: fonts.medium, fontSize: 9, lineHeight: 12, color: t.textInk.faint },
  checkLabel: { fontFamily: fonts.body, fontSize: 12, color: t.textInk.body },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: t.surfaces.cart,
  },
});
