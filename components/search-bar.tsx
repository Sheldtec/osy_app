import { LinearGradient } from "expo-linear-gradient";
import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { IconFilter, IconSearch } from "@/components/icons";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, radius } from "@/theme/tokens";

/**
 * "Search/Shop Elevated" — the white pill with a tinted icon tile and a
 * gradient filter button, from the Home (275:2) and Shop (249:450) frames.
 *
 * Both frames draw the SAME control, so it lives here once. What differs is
 * behaviour, not looks:
 *
 *   · Home is a button that navigates to Shop — there is nothing to type into
 *     on a screen that has no results to filter.
 *   · Shop is a live text field.
 *
 * Passing `value`/`onChangeText` selects the field; passing only `onPress`
 * selects the button. The two cannot drift apart visually because there is
 * only one set of styles.
 */

const PLACEHOLDER = "Search wigs, bundles, closures...";

interface Props {
  /** Field mode: the current query. */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Button mode: where tapping the pill goes. */
  onPress?: () => void;
  /** The gradient button on the right. */
  onFilter?: () => void;
  filterLabel?: string;
  /** Active filter count — shows a badge on the button when above zero. */
  filterCount?: number;
  autoFocus?: boolean;
  style?: object;
}

export const SearchBar = forwardRef<TextInput, Props>(function SearchBar(
  { value, onChangeText, onPress, onFilter, filterLabel = "Filter and sort", filterCount = 0, autoFocus, style },
  ref,
) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const isField = onChangeText !== undefined;

  const inner = (
    <>
      <IconSearch width={20} height={20} color={theme.colors.primaryOn} />

      {isField ? (
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={PLACEHOLDER}
          placeholderTextColor={theme.textInk.body}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search the catalogue"
          style={styles.input}
        />
      ) : (
        <Text style={styles.placeholder} numberOfLines={1}>
          {PLACEHOLDER}
        </Text>
      )}

      {/* Clearing is only reachable in field mode, and only with a query. */}
      {isField && value ? (
        <Pressable
          onPress={() => onChangeText?.("")}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clear}
        >
          <Text style={styles.clearGlyph}>×</Text>
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <Pressable
        onPress={onFilter}
        disabled={!onFilter}
        accessibilityRole="button"
        accessibilityLabel={
          filterCount ? `${filterLabel}, ${filterCount} active` : filterLabel
        }
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <View style={styles.filterWrap}>
          <LinearGradient
            colors={["#702B99", "#4F1775"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.filter}
          >
            <IconFilter width={19} height={19} />
          </LinearGradient>
        </View>
        {filterCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{filterCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </>
  );

  // A field must not sit inside a Pressable — the wrapper would swallow taps
  // meant for the caret and the clear button.
  if (isField) return <View style={[styles.bar, style]}>{inner}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel={PLACEHOLDER}
      style={({ pressed }) => [styles.bar, pressed && { opacity: 0.9 }, style]}
    >
      {inner}
    </Pressable>
  );
});

/**
 * Nested radii follow one rule: INNER = OUTER - PADDING.
 *
 * Get it wrong and the gap between two rounded shapes pinches at the corners,
 * which the eye reads as sloppy long before it can say why. This control had
 * three unrelated radii (20 outer, 13 on the icon tile, 15 on the button) and
 * used none of the design tokens, so every corner disagreed with every other.
 *
 * Now: the bar is radius.control, the padding is PAD, and the filter button is
 * exactly radius.control - PAD. Change one and the other follows.
 */
const PAD = 8;
const FILTER_SIZE = 40;

const makeStyles = (t: Theme) => StyleSheet.create({
  bar: {
    marginHorizontal: layout.gutter,
    // PAD above and below a FILTER_SIZE button, so the button is the height.
    height: FILTER_SIZE + PAD * 2,
    borderRadius: radius.control,
    backgroundColor: t.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: PAD,
    gap: 11,
  },
  placeholder: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: t.textInk.body },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: t.colors.ink,
    padding: 0,
    includeFontPadding: false,
  },
  clear: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  clearGlyph: { fontFamily: fonts.body, fontSize: 18, color: t.textInk.faint, lineHeight: 20 },
  divider: { width: 1, height: 22, backgroundColor: "rgba(115,69,133,0.14)" },
  filterWrap: { borderRadius: radius.control - PAD, overflow: "hidden" },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: t.colors.gold2,
    borderWidth: 1.5,
    borderColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: fonts.medium,
    fontSize: 9,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  filter: {
    width: FILTER_SIZE,
    height: FILTER_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
