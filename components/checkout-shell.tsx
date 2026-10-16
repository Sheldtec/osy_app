import { router } from "expo-router";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CircleBack, IconBackChevron } from "@/components/icons";
import { Steps } from "@/components/checkout-ui";
import { GradientButton, Overline, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * The frame every checkout step sits in.
 *
 * One scaffold rather than three, so the steps cannot drift apart: same header,
 * same step indicator, same keyboard behaviour, same bottom clearance for the
 * pay bar. The old checkout was a single screen and had none of this to share.
 *
 * Keyboard handling is deliberately set on BOTH platforms. The previous screens
 * used `behavior={Platform.OS === "ios" ? "padding" : undefined}`, which does
 * nothing on Android — and with the pay bar pinned to the bottom, the Android
 * keyboard covered the total and the Pay button while the address was being
 * typed. `height` is the behaviour that works with an edge-to-edge window.
 */
export function CheckoutShell({
  title,
  step,
  children,
  banner,
  footer,
  /** Room to leave under the content so the sticky footer never covers it. */
  footerSpace = 150,
  onBack,
}: {
  title: string;
  step?: 1 | 2 | 3;
  children: ReactNode;
  /**
   * Shown pinned directly above the footer.
   *
   * Errors used to render at the bottom of the scroll, below the fold, behind
   * a sticky bar — so the shopper tapped a button that looked like it did
   * nothing. A message about why the tap failed has to be where the tap was.
   */
  banner?: ReactNode;
  footer?: ReactNode;
  footerSpace?: number;
  onBack?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: footerSpace }}
        >
          <View style={styles.header}>
            <Pressable
              onPress={onBack ?? (() => router.back())}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={styles.backCircle}
            >
              <IconBackChevron width={22} height={22} color={theme.textInk.strong} />
            </Pressable>

            <Txt tone="ink" display size={22} style={styles.title}>
              {title}
            </Txt>
          </View>

          {step ? <Steps current={step} /> : null}

          {children}
        </ScrollView>
      </KeyboardAvoidingView>

      {banner ? <View style={styles.banner}>{banner}</View> : null}
      {footer}
    </View>
  );
}

/**
 * What a signed-out shopper sees.
 *
 * POST /orders is members-only, so there is no guest branch to build. The bag
 * survives sign-in, which is the thing worth saying.
 */
export function SignInGate() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.gate, { paddingTop: insets.top + 80 }]}>
      <Overline>CHECKOUT</Overline>
      <Txt tone="strong" display size={26} center style={{ marginTop: 12 }}>
        Sign in to place your order
      </Txt>
      <Txt tone="body" size={13} center style={{ marginTop: 12, lineHeight: 20 }}>
        Orders are tied to an account so you can track delivery, keep your history and use
        store credit. Your bag is saved.
      </Txt>
      <GradientButton
        label="Log in or create an account"
        style={{ marginTop: 26, alignSelf: "stretch" }}
        onPress={() => router.push("/auth")}
      />
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        style={({ pressed }) => [{ marginTop: 18 }, pressed && { opacity: 0.7 }]}
      >
        <Txt tone="primary" size={13} weight="medium">
          Back to bag
        </Txt>
      </Pressable>
    </View>
  );
}

/** True while the session is still being read — don't show the gate yet. */
export function useCheckoutAuth() {
  const { user, loading } = useAuth();
  return { user, loading, signedOut: !loading && !user };
}

const makeStyles = (t: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surfaces.checkout },
  // Sits on top of the scroll, immediately above the sticky footer.
  banner: { position: "absolute", left: 0, right: 0, bottom: 86, paddingHorizontal: layout.gutter },
  header: { height: 60, justifyContent: "center", marginBottom: 12 },
  backCircle: {
    position: "absolute",
    zIndex: 2,
    left: layout.gutter,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * The title is centred across the WHOLE header, so as a later sibling it was
   * painted over the absolutely-positioned back control and swallowed every
   * tap on it — the back arrow on every checkout and account screen was dead.
   * The title takes no pointer events, and the control is lifted above it.
   */
  title: { textAlign: "center", fontFamily: fonts.display, pointerEvents: "none" },
  gate: {
    flex: 1,
    backgroundColor: t.surfaces.checkout,
    alignItems: "center",
    paddingHorizontal: 28,
  },
});

