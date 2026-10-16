import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { Txt } from "@/components/ui";
import { naira } from "@/lib/format";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { ctaGradient, fonts, layout, shadow } from "@/theme/tokens";

/**
 * The controls a checkout needs and this app did not have.
 *
 * Before this file there was no shared text input (three screens had drifted
 * into three incompatible ones), no select, no radio row, no summary line, no
 * step indicator, no inline banner and no button that could show it was busy —
 * so every screen hand-rolled its own and the checkout ended up with a single
 * grey error string below the fold and no per-field messages at all.
 *
 * Everything here follows the shipped surface language rather than the tokens
 * that disagree with it: radius 16 on cards and controls, 12 on inputs, a 1px
 * `lineCheckout` hairline, and NO shadow on anything in flow — the owner
 * direction in theme/tokens.ts reserves shadow() for surfaces that genuinely
 * float over scrolling content, which here is only the pay bar.
 */

const GUTTER = layout.gutter;

/* ------------------------------------------------------------------ *
 * Section card
 * ------------------------------------------------------------------ */

/** The white checkout surface. Radius 16 and a lineCheckout hairline. */
export function SectionCard({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, padded && { padding: 14 }, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ *
 * Text field
 * ------------------------------------------------------------------ */

/**
 * A labelled input that can say what is wrong with it.
 *
 * `autoComplete`/`textContentType` are passed straight through, which is what
 * makes the OS offer a saved address — the old checkout set neither, so
 * autofill was dead on both platforms and every shopper retyped seven fields.
 */
export function Field({
  label,
  error,
  hint,
  trailing,
  style,
  account,
  ...input
  // `style` is the wrapper's, not the input's — the input is styled by this
  // component so every field in the flow measures identically.
}: Omit<TextInputProps, "style"> & {
  label: string;
  error?: string;
  hint?: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * The account area's scale. Those screens follow the My account tab —
   * 9px/1.4 grey labels and a softer hairline — and a checkout-weight label
   * inside one of its borderless cards is what makes the two read as
   * different apps.
   */
  account?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  const bad = Boolean(error);

  return (
    <View style={style}>
      <Text style={[styles.label, account && styles.labelAccount]}>{label.toUpperCase()}</Text>
      <View
        style={[
          styles.field,
          account && styles.fieldAccount,
          // A multiline field cannot keep the single-line fixed height — the
          // text runs straight out of the top of the well.
          input.multiline && styles.fieldMultiline,
          focused && { borderColor: theme.colors.primaryOn },
          bad && { borderColor: theme.colors.danger },
        ]}
      >
        <TextInput
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={theme.textInk.faint}
          // Android centres multiline text vertically by default, which looks
          // like a bug in a tall box.
          textAlignVertical={input.multiline ? "top" : undefined}
          style={[styles.input, input.multiline && styles.inputMultiline]}
          accessibilityLabel={label}
        />
        {trailing}
      </View>
      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 5 }}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt tone="faint" size={11} style={{ marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Select field + its sheet
 * ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A field-shaped button that opens a list.
 *
 * Used for State, which the server prices shipping from — free text there means
 * a typo quietly becomes the fallback rate, which is ₦31,000.
 */
export function SelectField({
  label,
  value,
  placeholder,
  options,
  onChange,
  error,
  style,
  account,
  bottomInset = 16,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  error?: string;
  style?: StyleProp<ViewStyle>;
  /** See Field — the account area's lighter label and hairline. */
  account?: boolean;
  bottomInset?: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);

  return (
    <View style={style}>
      <Text style={[styles.label, account && styles.labelAccount]}>{label.toUpperCase()}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${chosen?.label ?? placeholder}`}
        style={({ pressed }) => [
          styles.field,
          account && styles.fieldAccount,
          Boolean(error) && { borderColor: theme.colors.danger },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.input, !chosen && { color: theme.textInk.faint }]}
        >
          {chosen?.label ?? placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 5 }}>
          {error}
        </Txt>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityLabel={`Close ${label}`}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
          <View style={styles.handle} />
          <Txt tone="ink" display size={18} style={{ marginBottom: 10 }}>
            {label}
          </Txt>
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.7 }]}
                >
                  <Txt tone={active ? "primary" : "ink"} size={14} weight={active ? "medium" : "regular"}>
                    {o.label}
                  </Txt>
                  {active ? <Text style={styles.tick}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Choice row — delivery methods, payment methods
 * ------------------------------------------------------------------ */

/**
 * One selectable row with a radio on the right.
 *
 * `disabled` rows stay visible on purpose: a shopper who cannot see that bank
 * transfer exists assumes the shop does not take it, whereas a greyed row with
 * a reason tells them to come back.
 */
export function ChoiceRow({
  title,
  sub,
  trailing,
  selected,
  disabled,
  badge,
  leading,
  onPress,
}: {
  title: string;
  sub?: string;
  trailing?: string;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  leading?: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      accessibilityLabel={[title, sub, trailing].filter(Boolean).join(". ")}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        selected && { borderColor: theme.colors.primaryOn, backgroundColor: theme.surfaces.chipActive },
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      {leading ? <View style={styles.choiceLeading}>{leading}</View> : null}

      <View style={{ flex: 1 }}>
        <View style={styles.choiceTitleRow}>
          <Txt tone="ink" size={14} weight="medium">
            {title}
          </Txt>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {sub ? (
          <Txt tone="faint" size={11.5} style={{ marginTop: 2 }} numberOfLines={2}>
            {sub}
          </Txt>
        ) : null}
      </View>

      {trailing ? (
        <Txt tone="ink" size={13} weight="medium" style={{ marginRight: 10 }}>
          {trailing}
        </Txt>
      ) : null}

      <View style={[styles.radio, selected && { borderColor: theme.colors.primaryOn }]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Packaging tiers
 * ------------------------------------------------------------------ */

export function TierCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; price: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${o.label}, ${o.price === 0 ? "free" : naira(o.price)}`}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => [styles.tier, pressed && { opacity: 0.9 }]}
          >
            {active ? (
              <LinearGradient
                colors={[...ctaGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Text style={[styles.tierLabel, active && { color: "#FFFFFF" }]}>{o.label}</Text>
            <Text style={[styles.tierPrice, active && { color: "#E2D7EA" }]}>
              {o.price === 0 ? "Free" : `+${naira(o.price)}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Summary rows
 * ------------------------------------------------------------------ */

export function SummaryRow({
  label,
  value,
  tone = "body",
  strong,
  pending,
}: {
  label: string;
  value: string;
  tone?: "body" | "success" | "faint";
  strong?: boolean;
  /** Shows a spinner instead of the value while a quote is in flight. */
  pending?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryRow}>
      <Txt tone={strong ? "ink" : "faint"} size={13} weight={strong ? "medium" : "regular"}>
        {label}
      </Txt>
      {pending ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <Txt tone={tone === "success" ? "success" : strong ? "ink" : "body"} size={13} weight="medium">
          {value}
        </Txt>
      )}
    </View>
  );
}

export function Divider() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.divider} />;
}

/* ------------------------------------------------------------------ *
 * Inline banner
 * ------------------------------------------------------------------ */

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "danger" | "success";
  children: ReactNode;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const palette =
    tone === "danger"
      ? { bg: theme.colors.dangerBg, fg: theme.colors.danger, border: "rgba(192,71,62,0.22)" }
      : tone === "success"
        ? { bg: theme.colors.successBg, fg: theme.colors.success, border: "rgba(59,122,94,0.22)" }
        : { bg: theme.surfaces.noteTint, fg: theme.colors.gold2, border: "rgba(183,152,106,0.28)" };

  return (
    <View
      accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"}
      style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}
    >
      <Text style={[styles.noticeText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Step indicator
 * ------------------------------------------------------------------ */

/** Bag → Delivery → Payment, matching the website's three-step funnel. */
export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const labels = ["Bag", "Delivery", "Payment"];
  return (
    <View style={styles.steps} accessibilityLabel={`Step ${current} of 3, ${labels[current - 1]}`}>
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const here = n === current;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.stepDot,
                (done || here) && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primaryOn },
              ]}
            >
              <Text style={[styles.stepNum, (done || here) && { color: "#FFFFFF" }]}>
                {done ? "✓" : n}
              </Text>
            </View>
            <Text style={[styles.stepLabel, here && { color: theme.colors.primaryOn, fontFamily: fonts.medium }]}>
              {label}
            </Text>
            {n < 3 ? <View style={[styles.stepBar, done && { backgroundColor: theme.colors.primary }]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Sticky pay bar
 * ------------------------------------------------------------------ */

/**
 * The bottom bar. One CTA, and it can show it is working.
 *
 * The old bar used a fixed 200pt-wide button, which crowded a six-figure total
 * at 375pt. This one lets the total take the room it needs and the button take
 * the rest, with a 148pt floor so the label never wraps.
 */
export function PayBar({
  label,
  caption,
  total,
  totalNote,
  busy,
  disabled,
  bottomInset,
  onPress,
}: {
  label: string;
  caption: string;
  /** Omit on a bar that is not about money — the caption then stands alone. */
  total?: number;
  totalNote?: string;
  busy?: boolean;
  disabled?: boolean;
  bottomInset: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const off = Boolean(disabled) || Boolean(busy);

  return (
    <View style={[styles.payBar, { paddingBottom: bottomInset || 20 }]}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Txt tone="faint" size={11}>
          {caption}
        </Txt>
        {total !== undefined ? (
          <Txt
            tone="ink"
            display
            size={23}
            style={{ marginTop: 1 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {naira(total)}
          </Txt>
        ) : null}
        {totalNote ? (
          <Txt tone="faint" size={10.5} style={{ marginTop: 1 }} numberOfLines={1}>
            {totalNote}
          </Txt>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off, busy: Boolean(busy) }}
        onPress={off ? undefined : onPress}
        disabled={off}
        style={({ pressed }) => [styles.payBtn, off && { opacity: 0.45 }, pressed && { opacity: 0.9 }]}
      >
        <LinearGradient
          colors={[...ctaGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.payBtnFill}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.payBtnText} numberOfLines={1}>
              {label}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineCheckout,
  },

  label: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: t.textInk.soft,
    includeFontPadding: false,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 50,
    marginTop: 7,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.surfaces.lineCheckout,
    backgroundColor: t.colors.surface,
  },
  labelAccount: { fontSize: 9, letterSpacing: 1.4, color: t.textInk.body },
  /**
   * The account area's field: a tinted well, no visible edge.
   *
   * The border is KEPT but painted the same colour as the fill, so the control
   * reads as borderless (that area's rule — separation comes from fill, not
   * from a hairline) while `Field` and `SelectField` can still recolour that
   * same border for focus and error. Dropping borderWidth instead would have
   * silently removed the focus ring.
   */
  fieldAccount: {
    borderRadius: 14,
    backgroundColor: t.surfaces.stepperTrack,
    borderColor: t.surfaces.stepperTrack,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: t.colors.ink, padding: 0 },
  /** Grows with the text instead of clipping it out of the top of the well. */
  fieldMultiline: {
    height: undefined,
    minHeight: 104,
    alignItems: "flex-start",
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 80, lineHeight: 20 },
  chevron: { fontFamily: fonts.body, fontSize: 15, color: t.textInk.faint, marginTop: -5 },

  scrim: { flex: 1, backgroundColor: "rgba(20,12,26,0.34)" },
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.lineSoft,
  },
  tick: { fontFamily: fonts.medium, fontSize: 14, color: t.colors.primaryOn },

  choice: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineCheckout,
    backgroundColor: t.colors.surface,
  },
  choiceLeading: { marginRight: 11 },
  choiceTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  badge: {
    paddingHorizontal: 7,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.surfaces.noteTint,
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 0.6,
    color: t.colors.gold2,
    includeFontPadding: false,
  },
  radio: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: t.surfaces.lineProduct,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: t.colors.primary },

  tier: {
    flex: 1,
    height: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineCheckout,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tierLabel: { fontFamily: fonts.medium, fontSize: 13, color: t.colors.ink, includeFontPadding: false },
  tierPrice: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: t.textInk.faint,
    marginTop: 6,
    includeFontPadding: false,
  },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 26,
  },
  divider: { height: 1, backgroundColor: t.surfaces.lineSoft, marginVertical: 10 },

  notice: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, includeFontPadding: false },

  steps: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: GUTTER },
  step: { flexDirection: "row", alignItems: "center" },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  stepLabel: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: t.textInk.faint,
    marginLeft: 6,
    includeFontPadding: false,
  },
  stepBar: {
    width: 20,
    height: 1,
    backgroundColor: t.surfaces.lineProduct,
    marginHorizontal: 8,
  },

  payBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GUTTER,
    paddingTop: 12,
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.lineCheckout,
    // The one shadow allowed here: this bar floats over scrolling content.
    ...shadow({ color: "#1A121F", opacity: 0.05, radius: 16, offsetY: -4, elevation: 10 }),
  },
  payBtn: { minWidth: 148, height: 54, borderRadius: 27, overflow: "hidden" },
  payBtnFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  payBtnText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
});
