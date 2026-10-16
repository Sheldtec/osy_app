import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BRAND_LOGO,
  IconDelivery,
  IconEmail,
  IconEye,
  IconGift,
  IconLock,
  IconShield,
  SocialApple,
  SocialFacebook,
  SocialGoogle,
} from "@/components/icons";
import { Txt } from "@/components/ui";
import { AuthError, AuthTimeout, useAuth, type SignupStep } from "@/lib/auth";
import { API_BASE } from "@/lib/api";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { ctaGradient, fonts, layout } from "@/theme/tokens";

/**
 * Auth — Figma "Refined · 13 · Login" (249:950).
 *
 * One frame, two modes: the segmented control switches Log in / Sign up.
 *
 * Signing up is a THREE-STEP wizard — email, then phone, then password —
 * mirroring the website's `app/(auth)/signup/page.tsx`, because the API's
 * `RegisterRequest::stepRules()` is written for exactly those steps and
 * `POST /auth/signup/step` validates them one at a time.
 *
 * Before this, the app asked for a name (which the API does not accept, and
 * silently dropped) and never asked for a phone (which the API REQUIRES), so
 * every signup from the app failed validation — and because the error map only
 * read name/email/password, "the phone field is required" arrived against a
 * form with no phone field in it. There was no way through.
 *
 * The password policy is ticked off as you type rather than arriving as a 422.
 * PASSWORD_RULES is a mirror of the server's rule; if `stepRules()` changes,
 * change it with it.
 *
 * The three social buttons are drawn because the frame has them, but they are
 * DISABLED and say so on press. Native Google/Apple sign-in needs
 * expo-auth-session plus per-platform OAuth client IDs (and, for Apple, a paid
 * developer account) — none of which exist in this project yet. A button that
 * looks live and silently does nothing is worse than one that tells you.
 */
const GUTTER = layout.gutter;

type Mode = "login" | "signup";

const SIGNUP_STEPS: {
  id: SignupStep;
  label: string;
  heading: string;
  blurb: string;
}[] = [
  {
    id: "email",
    label: "Email",
    heading: "What’s your email?",
    blurb: "Order confirmations and your traceable codes go here.",
  },
  {
    id: "phone",
    label: "Phone",
    heading: "Your phone number",
    blurb: "For delivery updates — our rider calls this number.",
  },
  {
    id: "password",
    label: "Password",
    heading: "Choose a password",
    blurb: "Long and unusual beats short and clever.",
  },
];

/**
 * The server's password policy, mirrored.
 *
 * `Password::min(10)->mixedCase()->numbers()->symbols()->uncompromised()`.
 * `uncompromised()` cannot be checked on the device — it is a breach-database
 * lookup — so that one can still come back from the server, and shows up as a
 * field error on the password step.
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

/**
 * Which step owns each field the API can complain about.
 *
 * Used to send someone BACK to the screen that can fix the problem. The step
 * checks are advisory — the final submit is the authoritative one — so an
 * email can pass step one and still be taken by the time the account is made.
 */
const FIELD_STEP: Record<string, number> = {
  email: 0,
  phone: 1,
  referral_code: 1,
  password: 2,
};

export default function AuthScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { signIn, signUp, checkSignupStep } = useAuth();

  // Other screens can open this straight on the wizard, and a friend's invite
  // link carries its code in: /auth?mode=signup&ref=LX1234.
  const params = useLocalSearchParams<{ mode?: string; ref?: string }>();

  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? "signup" : "login");
  const [step, setStep] = useState(0);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referral, setReferral] = useState(() =>
    (params.ref ?? "").trim().toUpperCase().slice(0, 32),
  );

  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const current = SIGNUP_STEPS[step];
  const isLast = step === SIGNUP_STEPS.length - 1;

  const checks = useMemo(
    () => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password) })),
    [password],
  );
  const passwordStrong = checks.every((c) => c.ok);
  const confirmOk = confirm.length > 0 && confirm === password;

  /** Move to a step, and let a screen reader announce it. */
  function goTo(next: number) {
    setStep(next);
    setError(null);
    setFields({});
    AccessibilityInfo.announceForAccessibility(
      `Step ${next + 1} of ${SIGNUP_STEPS.length}. ${SIGNUP_STEPS[next].heading}`,
    );
  }

  function done() {
    // Back to whatever asked for auth; the Profile tab if nothing did.
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  function handle(err: unknown) {
    // Checked BEFORE AuthError, which it extends.
    //
    // Giving up waiting is not the same as failing. On the final step the
    // account may well have been created while we stopped listening, so the
    // way out is to try logging in — not to sign up again and be told the
    // email is taken.
    if (err instanceof AuthTimeout) {
      setError(
        isSignup && isLast
          ? "That took longer than expected, and your account may have been created anyway. Try logging in before you sign up again."
          : "The store took too long to answer. Please try again.",
      );

      return;
    }

    if (!(err instanceof AuthError)) {
      setError("Something went wrong. Please try again.");

      return;
    }

    const next: Record<string, string> = {};
    for (const key of ["email", "phone", "password", "referral_code"]) {
      const msg = err.fieldError(key);
      if (msg) next[key] = msg;
    }
    setFields(next);

    // A field message belongs under its field — and if that field lives on an
    // earlier screen, go back to it. "That email is taken", shown on the
    // password screen, is a dead end.
    if (isSignup) {
      const owners = Object.keys(next).map((k) => FIELD_STEP[k] ?? step);
      const earliest = owners.length ? Math.min(...owners) : step;
      if (earliest !== step) {
        setStep(earliest);
        AccessibilityInfo.announceForAccessibility(
          next[SIGNUP_STEPS[earliest].id] ?? SIGNUP_STEPS[earliest].heading,
        );
      }
    }

    // Anything not about a field is a page-level problem: throttling, or the
    // store being down.
    if (Object.keys(next).length === 0) setError(err.message);
  }

  async function advance() {
    setError(null);
    setFields({});

    if (!isSignup) {
      if (!email.trim() || !password) {
        setFields({
          ...(email.trim() ? {} : { email: "Please enter your email address." }),
          ...(password ? {} : { password: "Please enter your password." }),
        });

        return;
      }

      setBusy(true);
      try {
        await signIn(email, password);
        done();
      } catch (err) {
        handle(err);
      } finally {
        setBusy(false);
      }

      return;
    }

    // Cheap local checks first, so the obvious mistakes never leave the phone.
    if (current.id === "email" && !email.trim()) {
      setFields({ email: "Please enter your email address." });

      return;
    }
    if (current.id === "phone" && !phone.trim()) {
      setFields({ phone: "Please enter your phone number." });

      return;
    }
    if (current.id === "password") {
      if (!passwordStrong) {
        setFields({ password: "Please meet all the password requirements." });

        return;
      }
      if (!confirmOk) {
        setFields({ confirm: "The passwords do not match." });

        return;
      }
    }

    setBusy(true);
    try {
      if (current.id === "password") {
        // Only the final step writes anything.
        await signUp({
          email,
          phone,
          password,
          passwordConfirmation: confirm,
          referralCode: referral || undefined,
        });
        done();

        return;
      }

      // Earlier steps are checked by the server, so a taken email surfaces
      // here rather than two screens later.
      await checkSignupStep(
        current.id,
        current.id === "email" ? { email: email.trim() } : { phone: phone.trim() },
      );
      goTo(step + 1);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep(0);
    setError(null);
    setFields({});
    setNotice(null);
    // The email carries across: someone who typed it into the wrong mode
    // should not have to type it again.
  }

  const ctaLabel = busy
    ? isSignup
      ? isLast
        ? "Creating your account…"
        : "Checking…"
      : "Logging in…"
    : isSignup
      ? isLast
        ? "Create account"
        : "Continue"
      : "Log in";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.surfaces.auth }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: GUTTER,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Image source={BRAND_LOGO} style={styles.logo} contentFit="contain" />

        <Txt tone="ink" display size={24} center style={{ marginTop: 4 }}>
          OsyGentle
        </Txt>
        <Text style={styles.tagline}>BEAUTIFUL HAIR, VERIFIED</Text>

        {/* ---- Log in / Sign up ---- */}
        <View style={styles.segment}>
          {(["login", "signup"] as const).map((m) => {
            const active = mode === m;

            return (
              <Pressable
                key={m}
                onPress={() => switchMode(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
              >
                <Text
                  style={{
                    fontFamily: fonts.medium,
                    fontSize: 14,
                    color: active ? theme.colors.primary : theme.textInk.soft,
                  }}
                >
                  {m === "login" ? "Log in" : "Sign up"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isSignup ? (
          <>
            <Progress step={step} />

            <Txt tone="ink" display size={20} style={{ marginTop: 26 }}>
              {current.heading}
            </Txt>
            <Txt tone="soft" size={12} style={{ marginTop: 6, lineHeight: 18 }}>
              {current.blurb}
            </Txt>
          </>
        ) : null}

        {/* ---------------- step 1 · email (and the login email) ------------- */}
        {!isSignup || current.id === "email" ? (
          <Field
            key="email"
            label="EMAIL"
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            autoFocus={isSignup}
            returnKeyType="next"
            onSubmitEditing={() => void advance()}
            error={fields.email}
            icon={<IconEmail width={20} height={20} />}
          />
        ) : null}

        {/* ---------------- step 2 · phone + invite code -------------------- */}
        {isSignup && current.id === "phone" ? (
          <>
            <Field
              key="phone"
              label="PHONE"
              value={phone}
              onChangeText={setPhone}
              placeholder="+234 800 000 0000"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => void advance()}
              error={fields.phone}
              icon={<IconDelivery width={20} height={20} color={theme.colors.primaryOn} />}
            />

            <Field
              key="referral"
              label="INVITE CODE (OPTIONAL)"
              value={referral}
              onChangeText={(v) => setReferral(v.toUpperCase().slice(0, 32))}
              placeholder="From a friend"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => void advance()}
              error={fields.referral_code}
              icon={<IconGift width={20} height={20} />}
            />

            <Txt tone="soft" size={11} style={{ marginTop: 10 }}>
              Signing up as {email.trim()}
            </Txt>
          </>
        ) : null}

        {/* ---------------- step 3 · password (and the login password) ------- */}
        {!isSignup || current.id === "password" ? (
          <Field
            key="password"
            label="PASSWORD"
            value={password}
            onChangeText={setPassword}
            placeholder={isSignup ? "Create a password" : "••••••••"}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isSignup ? "new-password" : "current-password"}
            textContentType={isSignup ? "newPassword" : "password"}
            passwordRules={
              isSignup
                ? "minlength: 10; required: lower; required: upper; required: digit; required: special;"
                : undefined
            }
            autoFocus={isSignup}
            returnKeyType={isSignup ? "next" : "go"}
            onSubmitEditing={() => void advance()}
            error={fields.password}
            icon={<IconLock width={20} height={20} />}
            trailing={
              <Pressable
                onPress={() => setReveal((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={reveal ? "Hide password" : "Show password"}
              >
                <IconEye width={20} height={20} style={{ opacity: reveal ? 1 : 0.5 }} />
              </Pressable>
            }
          />
        ) : null}

        {isSignup && current.id === "password" ? (
          <>
            {password.length > 0 ? <PasswordChecks checks={checks} /> : null}

            <Field
              key="confirm"
              label="CONFIRM PASSWORD"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Re-enter your password"
              secureTextEntry={!reveal}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void advance()}
              error={
                fields.confirm ??
                (confirm.length > 0 && !confirmOk ? "The passwords do not match." : undefined)
              }
              icon={<IconLock width={20} height={20} />}
            />
          </>
        ) : null}

        {!isSignup ? (
          <Pressable
            onPress={() => setNotice("Password reset is not wired up yet.")}
            accessibilityRole="button"
            style={styles.forgot}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        ) : null}

        {error ? (
          <Txt tone="danger" size={12} style={{ marginTop: 14 }}>
            {error}
          </Txt>
        ) : null}

        {/* ---- Back / Continue ---- */}
        <View style={[styles.actions, { marginTop: error ? 14 : isSignup ? 24 : 16 }]}>
          {isSignup && step > 0 ? (
            <Pressable
              onPress={() => goTo(step - 1)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${SIGNUP_STEPS[step - 1].label.toLowerCase()}`}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => void advance()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ busy, disabled: busy }}
            style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.9 }]}
          >
            <LinearGradient
              colors={[...ctaGradient]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            )}
          </Pressable>
        </View>

        {/* ---- social: only where it can replace the WHOLE wizard ---- */}
        {!isSignup || step === 0 ? (
          <>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Txt tone="soft" size={12}>
                or continue with
              </Txt>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.socialRow}>
              <Social label="Google" onPress={setNotice}>
                <SocialGoogle width={22} height={22} />
              </Social>
              <Social label="Facebook" onPress={setNotice}>
                <SocialFacebook width={24} height={24} />
              </Social>
              <Social label="Apple" onPress={setNotice}>
                <SocialApple width={22} height={22} color={theme.textInk.strong} />
              </Social>
            </View>
          </>
        ) : null}

        {notice ? (
          <Txt tone="soft" size={11} center style={{ marginTop: 12 }}>
            {notice}
          </Txt>
        ) : null}

        <View style={styles.switchRow}>
          <Txt tone="soft" size={13}>
            {isSignup ? "Already have an account?" : "New to OsyGentle?"}
          </Txt>
          <Pressable
            onPress={() => switchMode(isSignup ? "login" : "signup")}
            accessibilityRole="button"
            hitSlop={6}
          >
            <Text style={styles.switchLink}>{isSignup ? "Log in" : "Create an account"}</Text>
          </Pressable>
        </View>

        <View style={styles.secure}>
          <IconShield width={14} height={14} />
          <Txt tone="soft" size={11}>
            Secured with 256-bit encryption
          </Txt>
        </View>

        <Txt tone="soft" size={11} center style={{ marginTop: 12, lineHeight: 17 }}>
          By continuing you agree to our Terms &amp; Privacy Policy.
        </Txt>

        {!API_BASE ? (
          // Being explicit beats letting someone believe they have an account.
          <Txt tone="soft" size={10} center style={{ marginTop: 18, lineHeight: 16 }}>
            No API is configured, so this signs you in locally for a look around.
            Set EXPO_PUBLIC_API_URL for real accounts.
          </Txt>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Three plain rules: done is purple, the one you are on is gold. */
function Progress({ step }: { step: number }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${SIGNUP_STEPS.length}: ${SIGNUP_STEPS[step].label}`}
    >
      {SIGNUP_STEPS.map((s, i) => (
        <View key={s.id} style={{ flex: 1 }}>
          <View
            style={[
              styles.progressRule,
              {
                backgroundColor:
                  i < step ? theme.colors.primary : i === step ? theme.colors.gold2 : theme.surfaces.lineSoft,
              },
            ]}
          />
          <Text
            style={[
              styles.progressLabel,
              { color: i === step ? theme.colors.gold2 : i < step ? theme.colors.primary : theme.textInk.faint },
            ]}
          >
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The server's password policy, ticked off live instead of arriving as a 422. */
function PasswordChecks({ checks }: { checks: { id: string; label: string; ok: boolean }[] }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.checks}>
      {checks.map((c) => (
        <View
          key={c.id}
          style={styles.check}
          accessibilityLabel={`${c.label}: ${c.ok ? "met" : "not met"}`}
        >
          <View style={[styles.checkDot, c.ok && { backgroundColor: theme.colors.success }]}>
            <Text style={[styles.checkGlyph, c.ok && { color: "#FFFFFF" }]}>
              {c.ok ? "✓" : "•"}
            </Text>
          </View>
          <Text style={[styles.checkLabel, c.ok && { color: theme.colors.success }]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Labelled field — gold-tracked caps label over a bordered white pill. */
function Field({
  label,
  icon,
  trailing,
  error,
  ...input
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  error?: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.field, Boolean(error) && { borderColor: theme.colors.danger }]}>
        {icon}
        <TextInput
          {...input}
          placeholderTextColor={theme.textInk.soft}
          style={styles.input}
          accessibilityLabel={label}
        />
        {trailing}
      </View>
      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 6 }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

function Social({
  label,
  children,
  onPress,
}: {
  label: string;
  children: React.ReactNode;
  onPress: (notice: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={() => onPress(`${label} sign-in is not connected yet.`)}
      accessibilityRole="button"
      accessibilityLabel={`Continue with ${label}`}
      accessibilityState={{ disabled: true }}
      style={({ pressed }) => [styles.social, pressed && { opacity: 0.7 }]}
    >
      {children}
      <Text style={styles.socialLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  logo: { width: 87, height: 106, alignSelf: "center" },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    letterSpacing: 2.4,
    color: t.colors.gold2,
    textAlign: "center",
    marginTop: 8,
  },

  segment: {
    flexDirection: "row",
    backgroundColor: t.surfaces.segmentTrack,
    borderRadius: 13,
    padding: 4,
    marginTop: 34,
  },
  segmentItem: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentItemActive: { backgroundColor: t.colors.surface },

  progress: { flexDirection: "row", gap: 8, marginTop: 26 },
  progressRule: { height: 3, borderRadius: 2 },
  progressLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 7,
  },

  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: t.textInk.soft,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 56,
    marginTop: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineField,
    backgroundColor: t.colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: t.colors.ink },

  checks: { marginTop: 14, gap: 8 },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.surfaces.lineSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  checkGlyph: { fontFamily: fonts.medium, fontSize: 9, lineHeight: 12, color: t.textInk.faint },
  checkLabel: { fontFamily: fonts.body, fontSize: 12, color: t.textInk.body },

  forgot: { alignSelf: "flex-end", marginTop: 12 },
  forgotText: { fontFamily: fonts.medium, fontSize: 13, color: t.colors.gold2 },

  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    height: 56,
    paddingHorizontal: 26,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: t.surfaces.lineField,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { fontFamily: fonts.medium, fontSize: 15, color: t.textInk.body },

  cta: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontFamily: fonts.medium, fontSize: 16, color: "#FFFFFF" },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 26 },
  dividerLine: { flex: 1, height: 1, backgroundColor: t.surfaces.lineSoft },

  socialRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  social: {
    flex: 1,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineField,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  socialLabel: { fontFamily: fonts.medium, fontSize: 10.5, color: t.textInk.body },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 26,
  },
  switchLink: { fontFamily: fonts.medium, fontSize: 13.5, color: t.colors.primaryOn },

  secure: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 26,
  },
});
