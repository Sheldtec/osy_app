import { LinearGradient } from "expo-linear-gradient";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { ctaGradient, fonts, radius, softShadow } from "@/theme/tokens";
import type { Theme } from "@/theme/theme";

/**
 * The shared surface language of the re-skin: rounded white cards with a
 * gentle diffuse shadow, pill controls, and type that always states its own
 * family (React Native inherits nothing across component boundaries).
 *
 * Reach for these instead of writing fontFamily or hex by hand — that is how a
 * locked design system quietly drifts.
 */

// ---- type ------------------------------------------------------------------

export type Tone =
  | "ink"
  | "strong"
  | "body"
  | "soft"
  | "faint"
  | "primary"
  | "gold"
  | "white"
  | "success"
  | "danger";

/**
 * Tones resolved against the active palette.
 *
 * `primary` reads `primaryOn`, not `primary`: this table is only ever used for
 * TEXT, and brand purple on a dark ground is around 1.6:1. Purple FILLS still
 * use `colors.primary` directly — there the white on top carries the contrast.
 *
 * `white` stays literal. It means "on top of a purple fill or a photograph",
 * which is white in both themes.
 */
function toneColor(t: Theme): Record<Tone, string> {
  return {
    ink: t.colors.ink,
    strong: t.textInk.strong,
    body: t.textInk.body,
    soft: t.textInk.soft,
    faint: t.textInk.faint,
    primary: t.colors.primaryOn,
    gold: t.colors.gold2,
    white: "#FFFFFF",
    success: t.colors.success,
    danger: t.colors.danger,
  };
}

interface TxtProps extends TextProps {
  tone?: Tone;
  size?: number;
  /** Fraunces instead of DM Sans — headings, prices, big numbers. */
  display?: boolean;
  weight?: "regular" | "medium" | "bold";
  center?: boolean;
  style?: StyleProp<TextStyle>;
}

export function Txt({
  tone = "body",
  size = 13,
  display,
  weight = "regular",
  center,
  style,
  ...rest
}: TxtProps) {
  const theme = useTheme();
  const family = display
    ? fonts.display
    : weight === "bold"
      ? fonts.bold
      : weight === "medium"
        ? fonts.medium
        : fonts.body;

  return (
    <Text
      {...rest}
      style={[
        // Android pads every Text box beyond its lineHeight, which breaks any
        // layout that positions text by measured height. Off everywhere so the
        // two platforms agree.
        { fontFamily: family, fontSize: size, color: toneColor(theme)[tone], includeFontPadding: false },
        center && { textAlign: "center" },
        style,
      ]}
    />
  );
}

/** Gold letterspaced section label — "DELIVERY", "PACKAGING". */
export function Overline({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();

  return (
    <Text
      style={[
        {
          fontFamily: fonts.medium,
          fontSize: 11,
          letterSpacing: 2.4,
          color: theme.colors.gold2,
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ---- surfaces --------------------------------------------------------------

export function Card({
  children,
  style,
  padded = true,
  soft = false,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Opt IN to a lift. Only for surfaces that float over scrolling content —
   *  cards are flat by owner direction (see tokens.ts). */
  soft?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      style={[
        styles.card,
        soft && softShadow,
        padded && { padding: 12 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Selectable pill — lengths, colours, filters. */
export function Chip({
  label,
  selected,
  onPress,
  width,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  width?: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      style={({ pressed }) => [
        styles.chip,
        width != null && { width },
        {
          backgroundColor: selected ? theme.surfaces.chipActive : theme.colors.surface,
          borderColor: selected ? theme.colors.primaryOn : theme.surfaces.lineProduct,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          fontFamily: selected ? fonts.medium : fonts.body,
          fontSize: 11,
          color: selected ? theme.colors.primaryOn : theme.textInk.body,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Small status pill — IN STOCK, FREE, BEST SELLER. */
export function Badge({
  label,
  bg,
  fg,
  style,
}: {
  label: string;
  bg?: string;
  fg?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.badge, { backgroundColor: bg ?? theme.surfaces.stockBg }, style]}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 9, color: fg ?? theme.surfaces.stockInk }}>
        {label}
      </Text>
    </View>
  );
}

/** The purple CTA — reserved for the one primary action on a screen. */
export function GradientButton({
  label,
  onPress,
  icon,
  height = 54,
  style,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  height?: number;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        {
          height,
          borderRadius: height / 2,
          overflow: "hidden",
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={[...ctaGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cta}
      >
        {icon}
        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: "#FFFFFF" }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/** "− 1 +" quantity control. */
export function Stepper({
  qty,
  onChange,
  compact,
}: {
  qty: number;
  onChange: (qty: number) => void;
  /** The cart's inline variant; the product bar uses the wider one. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const size = compact ? 27 : 30;

  return (
    <View style={[styles.stepper, { height: compact ? 36 : 54, borderRadius: compact ? 18 : 18 }]}>
      <Pressable
        onPress={() => onChange(qty - 1)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        style={[styles.stepBtn, { width: size, height: size, backgroundColor: theme.colors.surface }]}
      >
        <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: theme.colors.primaryOn }}>−</Text>
      </Pressable>

      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: theme.textInk.strong }}>{qty}</Text>

      <Pressable
        onPress={() => onChange(qty + 1)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        style={[styles.stepBtn, { width: size, height: size, backgroundColor: theme.colors.primary }]}
      >
        <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: "#FFFFFF" }}>+</Text>
      </Pressable>
    </View>
  );
}

/** Circular icon button — the back / favourite circles on the product sheet. */
export function CircleButton({
  children,
  onPress,
  size = 46,
  label,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  size?: number;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          // Not themed: this circle sits over product photography, and the
          // caller supplies the glyph colour. Flipping it dark would put a
          // dark glyph on a dark circle.
          backgroundColor: "rgba(255,255,255,0.92)",
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: t.surfaces.line,
  },
  chip: {
    height: 38,
    minWidth: 58,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    height: 22,
    paddingHorizontal: 10,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  cta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 5,
    width: 104,
    backgroundColor: t.surfaces.stepperTrack,
  },
  stepBtn: { borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
