import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BRAND_LOGO,
  ChevronRight,
  IconGlobe,
  ONBOARDING_HERO,
  OnboardingEllipse,
  OnboardingMedallionA,
  OnboardingMedallionB,
} from "@/components/icons";
import { GradientButton, Overline, Txt } from "@/components/ui";
import { markOnboarded } from "@/lib/onboarding";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * Onboarding — Figma "Refined · 8 · Onboarding" (249:602).
 *
 * A full-bleed portrait under the brand's purple, with the medallion and
 * wordmark centred on it; then a white sheet with the welcome copy, the
 * language/currency pills and two calls to action.
 *
 * Two departures from the frame, both deliberate:
 *   · The currency pill reads ₦ NGN, not € EUR. This store is Naira-only
 *     (CLAUDE.md), so it is a statement of fact rather than a choice.
 *   · Neither pill opens a picker yet — there is one language and one currency
 *     — so tapping them says so instead of opening an empty menu.
 */
const GUTTER = layout.gutter;
const PANEL_RATIO = 1; // the frame's panel is a square (440 × 440)

export default function OnboardingScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [notice, setNotice] = useState<string | null>(null);

  const panelHeight = Math.min(width * PANEL_RATIO, 440);

  async function go(to: "/" | "/auth") {
    await markOnboarded();
    router.replace(to);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaces.checkout }}>
      {/* This screen is deliberately full-bleed: the brand panel runs under the
          status bar. That panel is a dark purple wash, so the global dark icons
          set in the root layout would be dark-on-dark here. Light for this
          screen only — StatusBar is a stack, so the root layout's entry is
          restored when this screen unmounts. */}
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* ---- brand panel ---- */}
        <View style={{ height: panelHeight, overflow: "hidden" }}>
          <Image source={ONBOARDING_HERO} contentFit="cover" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={["rgba(106,50,144,0.78)", "rgba(61,26,87,0.86)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <OnboardingEllipse width={360} height={360} style={styles.bigEllipse} />

          <View style={[styles.brand, { top: panelHeight * 0.34 }]}>
            <View style={styles.medallion}>
              <OnboardingMedallionA width={72} height={72} style={StyleSheet.absoluteFill} />
              <OnboardingMedallionB width={72} height={72} style={StyleSheet.absoluteFill} />
              <Image source={BRAND_LOGO} contentFit="contain" style={styles.medallionLogo} />
            </View>
            <Text style={styles.wordmark}>OSYGENTLE</Text>
            <Text style={styles.tagline}>HAIR LIMITED</Text>
          </View>
        </View>

        {/* ---- welcome sheet ---- */}
        <View style={[styles.sheet, { paddingHorizontal: GUTTER }]}>
          <Overline>WELCOME</Overline>
          <Txt tone="ink" display size={32} style={{ marginTop: 10, lineHeight: 38 }}>
            Beautiful hair,{"\n"}verified.
          </Txt>
          <Txt tone="faint" size={13.5} style={{ marginTop: 14, lineHeight: 20 }}>
            Shop authentic wigs &amp; bundles — with proof in every pack, and resale you can
            trust.
          </Txt>

          <Text style={styles.sectionLabel}>LANGUAGE &amp; CURRENCY</Text>
          <View style={styles.pills}>
            <Pressable
              onPress={() => setNotice("English is the only language for now.")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.pill, { flex: 1.8 }, pressed && { opacity: 0.8 }]}
            >
              <IconGlobe width={20} height={20} color={theme.colors.primaryOn} />
              <Text style={styles.pillText}>English (UK)</Text>
              <View style={{ flex: 1 }} />
              <ChevronRight width={18} height={18} />
            </Pressable>

            <Pressable
              onPress={() => setNotice("Prices are in Naira. Other currencies are coming.")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.pill, { flex: 1 }, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.pillText}>₦  NGN</Text>
              <View style={{ flex: 1 }} />
              <ChevronRight width={18} height={18} />
            </Pressable>
          </View>
          {notice ? (
            <Txt tone="faint" size={11} style={{ marginTop: 8 }}>
              {notice}
            </Txt>
          ) : null}

          <GradientButton label="Get started" height={56} style={{ marginTop: 24 }} onPress={() => void go("/")} />

          <Pressable
            onPress={() => void go("/auth")}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </Pressable>

          <Txt tone="faint" size={12} center style={{ marginTop: 22 }}>
            By continuing you agree to our Terms &amp; Privacy Policy.
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  bigEllipse: { position: "absolute", right: -100, top: -40, opacity: 0.9 },
  brand: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  medallion: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  medallionLogo: { width: 47, height: 57 },
  wordmark: {
    marginTop: 22,
    fontFamily: fonts.display,
    fontSize: 40,
    letterSpacing: 1.5,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  tagline: {
    marginTop: 10,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 3,
    color: t.colors.gold1,
    includeFontPadding: false,
  },

  // Rides up over the panel's lower edge, as the frame's rounded sheet does.
  sheet: {
    marginTop: -44,
    backgroundColor: t.surfaces.home,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 36,
  },
  sectionLabel: {
    marginTop: 26,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 1.6,
    color: t.textInk.faint,
  },
  pills: { flexDirection: "row", gap: 12, marginTop: 12 },
  pill: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: t.surfaces.lineSoft,
    backgroundColor: t.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  pillText: { fontFamily: fonts.medium, fontSize: 14, color: t.colors.ink },
  secondary: {
    marginTop: 12,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineField,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontFamily: fonts.medium, fontSize: 16, color: t.colors.primaryOn },
});
