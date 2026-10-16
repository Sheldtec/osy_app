import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HairImage } from "@/components/hair-image";
import { IconBackChevron, IconSearch } from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * The account area's surface language, taken from the My account tab.
 *
 * That screen is the pattern these follow, and it is NOT the checkout
 * language. The differences are deliberate and load-bearing:
 *
 *   · BORDERLESS white cards on the tinted `cart` ground. Separation comes
 *     from the page colour, not from a hairline — a 1px `lineCheckout` border
 *     is the checkout idiom and reads as a form field here.
 *   · Radius 20 on cards, pill radii on the small controls.
 *   · The title is LEFT-aligned Fraunces 28 with a body subtitle beneath and a
 *     circular control in the corner — not a centred title over a back circle.
 *   · Small type: section labels 9px grey (not the gold 11px Overline), row
 *     labels 11, row subs 9, section heads 17.
 *
 * Extracted rather than copied per screen so the five account screens cannot
 * drift from the tab they hang off.
 */

const GUTTER = layout.gutter;

/**
 * The account area's header, on its own.
 *
 * `AccountShell` owns a ScrollView, which is right for a list of panels and
 * wrong for a chat — a thread needs its own scroller with a composer pinned
 * below it. Rather than copy the header into those screens (where it would
 * drift), it is exported here and both use the same styles.
 */
export function AccountHeader({
  title,
  subtitle,
  action,
  onBack,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; icon: ReactNode; onPress: () => void };
  onBack?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  return (
    <>
      <Pressable
        onPress={() =>
          onBack
            ? onBack()
            : router.canGoBack()
              ? router.back()
              : router.replace("/profile")
        }
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={10}
        style={({ pressed }) => [styles.circle, pressed && { opacity: 0.75 }]}
      >
        <IconBackChevron width={20} height={20} color={theme.textInk.strong} />
      </Pressable>

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt tone="strong" display size={28}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt tone="body" size={12} style={{ marginTop: 8, lineHeight: 18 }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>

        {action ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={8}
            style={({ pressed }) => [styles.circle, pressed && { opacity: 0.75 }]}
          >
            {action.icon}
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

export function AccountShell({
  title,
  subtitle,
  children,
  footer,
  action,
  onRefresh,
  refreshing,
  footerSpace = 40,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** The circular control in the top-right, as Settings is on the tab. */
  action?: { label: string; icon: ReactNode; onPress: () => void };
  onRefresh?: () => void;
  refreshing?: boolean;
  footerSpace?: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaces.cart }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: footerSpace + insets.bottom,
          paddingHorizontal: GUTTER,
        }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          ) : undefined
        }
      >
        {/* Back sits ABOVE the title, not beside it. The title is left-aligned
            on the tab's grid, and a leading circle would shove it off that
            grid — which is what made these screens read as a different app. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={({ pressed }) => [styles.circle, pressed && { opacity: 0.75 }]}
        >
          <IconBackChevron width={20} height={20} color={theme.textInk.strong} />
        </Pressable>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Txt tone="strong" display size={28}>
              {title}
            </Txt>
            {subtitle ? (
              <Txt tone="body" size={12} style={{ marginTop: 8, lineHeight: 18 }}>
                {subtitle}
              </Txt>
            ) : null}
          </View>

          {action ? (
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={8}
              style={({ pressed }) => [styles.circle, pressed && { opacity: 0.75 }]}
            >
              {action.icon}
            </Pressable>
          ) : null}
        </View>

        {children}
      </ScrollView>

      {footer}
    </View>
  );
}

/**
 * The account area's search field.
 *
 * A white pill on the tinted ground, so it reads as part of this area rather
 * than as the shop's search bar — that one is a radius-24 control with a
 * gradient filter button beside it, which would bring the catalogue's language
 * onto an account screen.
 *
 * The clear button only appears once there is something to clear: a permanent
 * ✕ on an empty field is a control that does nothing.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** What is being searched, for screen readers. */
  label: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.search}>
      <IconSearch width={16} height={16} color={theme.colors.primaryOn} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textInk.body}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          onPress={() => onChange("")}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          style={({ pressed }) => [styles.searchClear, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.searchClearText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A scrolling row of filter pills.
 *
 * Scrolling rather than a segmented control because there are six buckets and
 * a segment that narrow at 375pt would truncate every label. The row bleeds
 * past the gutter on both sides so the last pill is visibly cut off — that is
 * what tells someone it scrolls, and a row that ends flush reads as complete.
 */
export function FilterChips({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (key: string) => void;
  /** What is being filtered, for screen readers. */
  label: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                o.count === undefined ? o.label : `${o.label}, ${o.count}`
              }
              onPress={() => onChange(o.key)}
              style={({ pressed }) => [
                styles.chip,
                active && { backgroundColor: theme.colors.primary },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.chipText, active && { color: "#FFFFFF" }]}>{o.label}</Text>
              {o.count !== undefined ? (
                <Text style={[styles.chipCount, active && { color: "rgba(255,255,255,0.75)" }]}>
                  {o.count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * A compact sort control that opens a sheet.
 *
 * A button rather than another pill row: sorting is one choice out of four and
 * a second scrolling row beside the status filter would read as more filters.
 * The current choice is on the button, so the list never sorts in a way the
 * screen does not say out loud.
 */
export function SortControl({
  options,
  value,
  onChange,
  bottomInset = 16,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  bottomInset?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.key === value);

  return (
    <View style={styles.sortRow}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Sort orders. Currently ${chosen?.label ?? "default"}`}
        hitSlop={8}
        style={({ pressed }) => [styles.sortBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.sortText}>{chosen?.label ?? "Sort"}</Text>
        <Text style={styles.sortChevron}>⌄</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close sort" />
        <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
          <View style={styles.handle} />
          <Txt tone="strong" display size={18} style={{ marginBottom: 10 }}>
            Sort by
          </Txt>
          {options.map((o) => {
            const active = o.key === value;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.7 }]}
              >
                <Txt tone={active ? "primary" : "strong"} size={13} weight={active ? "medium" : "regular"}>
                  {o.label}
                </Txt>
                {active ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

/** The borderless white card. Radius 20, like the tab's own cards. */
export function Panel({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: object;
  padded?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.panel, padded && { padding: 16 }, style]}>{children}</View>;
}

/**
 * The small grey section label.
 *
 * Not the gold `Overline` from the storefront: the account tab uses 9px at
 * 1.4 letterspacing in body grey, and mixing the two inside one area is what
 * makes a screen look assembled from parts.
 */
export function SectionLabel({ children, style }: { children: string; style?: object }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.overline, style]}>{children}</Text>;
}

/** A section heading with an optional pill action, as "My orders · View all". */
export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHead}>
      <Txt tone="strong" weight="medium" size={17} style={{ flex: 1 }}>
        {title}
      </Txt>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.pillAction, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.pillActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A fixed-size product thumbnail.
 *
 * HairImage positions a real photo with `StyleSheet.absoluteFill` so it fills
 * whatever well it is dropped into — which means it needs a SIZED parent and
 * cannot be sized by its own style prop. Handing it width/height directly left
 * it absolutely positioned and spilling across the row behind the text.
 */
export function Thumb({
  src,
  seed,
  alt,
  width = 56,
  height = 64,
  radius = 14,
}: {
  src?: string | null;
  seed: string;
  alt: string;
  width?: number;
  height?: number;
  radius?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ width, height, borderRadius: radius, overflow: "hidden", backgroundColor: theme.colors.imgBg }}
    >
      <HairImage src={src} seed={seed} alt={alt} monogramSize={Math.round(height * 0.5)} />
    </View>
  );
}

/** While the first load is in flight. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.colors.primary} />
      <Txt tone="body" size={11} style={{ marginTop: 12 }}>
        {label}
      </Txt>
    </View>
  );
}

/** When the load failed — always with a way to try again. */
export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.state}>
      <Txt tone="danger" size={12} center style={{ lineHeight: 18 }}>
        {message}
      </Txt>
      <GradientButton label="Try again" style={{ marginTop: 20, minWidth: 180 }} onPress={onRetry} />
    </View>
  );
}

/** When there is genuinely nothing — which is not the same as failing. */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.state}>
      <Txt tone="strong" display size={19} center>
        {title}
      </Txt>
      <Txt tone="body" size={11} center style={{ marginTop: 10, lineHeight: 17 }}>
        {body}
      </Txt>
      {action ? (
        <GradientButton
          label={action.label}
          style={{ marginTop: 22, minWidth: 200 }}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}

/** A small status pill — order state, coupon state, membership state. */
export function Pill({ label, tone }: { label: string; tone: "ok" | "warn" | "bad" | "mute" }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const palette =
    tone === "ok"
      ? { bg: theme.colors.successBg, fg: theme.colors.success }
      : tone === "bad"
        ? { bg: theme.colors.dangerBg, fg: theme.colors.danger }
        : tone === "warn"
          ? { bg: theme.surfaces.noteTint, fg: theme.colors.gold2 }
          : { bg: theme.surfaces.verifiedTint, fg: theme.colors.primary };

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/**
 * A row inside a grouped card, exactly as the account tab draws them: a 34pt
 * icon well, an 11pt label over a 9pt sub, and a divider inset to clear the
 * icon.
 */
export function Row({
  label,
  sub,
  icon,
  trailing,
  last,
  onPress,
}: {
  label: string;
  sub?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Suppresses the divider on the final row of a card. */
  last?: boolean;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const body = (
    <>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}

      <View style={{ flex: 1, marginLeft: icon ? 12 : 0 }}>
        <Txt tone="strong" weight="medium" size={11}>
          {label}
        </Txt>
        {sub ? (
          <Txt tone="body" size={9} style={{ marginTop: 4 }} numberOfLines={2}>
            {sub}
          </Txt>
        ) : null}
      </View>

      {trailing}
      {!last ? <View style={styles.rowDivider} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

/** A key/value line inside a panel, in the account tab's small type. */
export function Line({
  label,
  value,
  tone = "body",
  strong,
}: {
  label: string;
  value: string;
  tone?: "body" | "success" | "danger";
  strong?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.line}>
      <Txt
        tone={strong ? "strong" : "body"}
        size={strong ? 12 : 11}
        weight={strong ? "medium" : "regular"}
      >
        {label}
      </Txt>
      <Txt
        tone={tone === "success" ? "success" : tone === "danger" ? "danger" : strong ? "strong" : "body"}
        size={strong ? 13 : 11}
        weight="medium"
      >
        {value}
      </Txt>
    </View>
  );
}

export function Divide() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.divide} />;
}

const makeStyles = (t: Theme) => StyleSheet.create({
  circle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { flexDirection: "row", alignItems: "flex-start", marginTop: 18 },

  panel: { backgroundColor: t.colors.surface, borderRadius: 20, marginTop: 12 },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 23,
    backgroundColor: t.colors.surface,
    marginTop: 18,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: t.colors.ink,
    padding: 0,
    // Without this the field is a couple of points taller on Android than iOS
    // and the pill stops being a pill.
    includeFontPadding: false,
  },
  searchClear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.surfaces.segmentTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  searchClearText: { fontFamily: fonts.medium, fontSize: 9, color: t.textInk.body },

  // Negative margins let the row bleed to the screen edges while the content
  // keeps the gutter, so a pill can sit half-cut at the fold.
  chipScroll: { marginTop: 14, marginHorizontal: -layout.gutter },
  chipRow: { paddingHorizontal: layout.gutter, gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: t.colors.surface,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 10, color: t.textInk.body, includeFontPadding: false },

  sortRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 12 },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  sortText: { fontFamily: fonts.medium, fontSize: 10, color: t.colors.primaryOn, includeFontPadding: false },
  sortChevron: { fontFamily: fonts.body, fontSize: 13, color: t.colors.primaryOn, marginTop: -4 },

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
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.lineSoft,
  },
  tick: { fontFamily: fonts.medium, fontSize: 14, color: t.colors.primaryOn },
  chipCount: {
    fontFamily: fonts.medium,
    fontSize: 9,
    color: t.textInk.faint,
    includeFontPadding: false,
  },

  overline: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.body,
    marginTop: 26,
  },

  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 26 },
  pillAction: {
    height: 30,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActionText: { fontFamily: fonts.medium, fontSize: 10, color: t.colors.primaryOn },

  state: { alignItems: "center", paddingHorizontal: 20, paddingTop: 54, paddingBottom: 40 },

  pill: {
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 0.4, includeFontPadding: false },

  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  rowDivider: {
    position: "absolute",
    left: 60,
    right: 14,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.segmentTrack,
  },

  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 24,
  },
  divide: { height: 1, backgroundColor: t.surfaces.lineSoft, marginVertical: 12 },
});

/** Room to leave under a sticky action. */
export const FOOTER_SPACE = Platform.OS === "ios" ? 120 : 110;
