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
 * Passing `onChangeText` selects the field; passing only `onPress` selects the
 * button. The two cannot drift apart visually because there is only one set of
 * styles.
 *
 * A BUTTON STILL SHOWS `value`. The shop's bar opens the search sheet rather
 * than typing in place, and a bar that reads "Search wigs, bundles,
 * closures..." over a grid narrowed by a sentence is lying about the state of
 * the screen — so the committed query takes the placeholder's spot, in ink
 * rather than grey, with its own clear button.
 */

const PLACEHOLDER = "Search wigs, bundles, closures...";

interface Props {
  /** The current query — typed, in field mode; committed, in button mode. */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Button mode: where tapping the pill goes. */
  onPress?: () => void;
  /** Button mode: clear the committed query without opening anything. */
  onClear?: () => void;
  /** Called on the keyboard's search key. */
  onSubmit?: () => void;
  /** The gradient button on the right. */
  onFilter?: () => void;
  filterLabel?: string;
  /** Active filter count — shows a badge on the button when above zero. */
  filterCount?: number;
  /**
   * Draw the gradient filter button at all.
   *
   * False inside the search sheet, which has nothing to filter: a gradient
   * button that cannot do anything is worse than no button, because the
   * shopper spends a tap and a little trust finding that out.
   */
  showFilter?: boolean;
  autoFocus?: boolean;
  style?: object;
}

export const SearchBar = forwardRef<TextInput, Props>(function SearchBar(
  {
    value,
    onChangeText,
    onPress,
    onClear,
    onSubmit,
    onFilter,
    filterLabel = "Filter and sort",
    filterCount = 0,
    showFilter = true,
    autoFocus,
    style,
  },
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
          onSubmitEditing={onSubmit}
          accessibilityLabel="Search the catalogue"
          style={styles.input}
        />
      ) : (
        <Text
          style={value ? styles.committed : styles.placeholder}
          numberOfLines={1}
        >
          {value || PLACEHOLDER}
        </Text>
      )}

      {/* Clearing needs a query, and — in button mode — somewhere to send the
          clear, since the bar does not own the committed one. */}
      {value && (isField || onClear) ? (
        <Pressable
          onPress={() => (isField ? onChangeText?.("") : onClear?.())}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clear}
        >
          <Text style={styles.clearGlyph}>×</Text>
        </Pressable>
      ) : null}

      {showFilter ? (
        <>
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
      ) : null}
    </>
  );

  // Without the filter button the right edge needs the left edge's padding,
  // or the pill reads as having lost something off the end.
  const bar = [styles.bar, !showFilter && styles.barBare];

  // A field must not sit inside a Pressable — the wrapper would swallow taps
  // meant for the caret and the clear button.
  if (isField) return <View style={[bar, style]}>{inner}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel={value ? `Search. Current search: ${value}` : PLACEHOLDER}
      style={({ pressed }) => [bar, pressed && { opacity: 0.9 }, style]}
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
  barBare: { paddingRight: 16 },
  placeholder: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: t.textInk.body },
  /** A committed query is content, not a prompt — it reads in ink. */
  committed: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: t.colors.ink },
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
