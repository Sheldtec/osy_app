import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { IconSearch } from "@/components/icons";
import { Txt } from "@/components/ui";
import { COUNTRIES, countryName, normalizeCountry, searchCountries, type Country } from "@/lib/geo";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * The country row, shared by checkout and the account screens.
 *
 * It is `SelectField`'s twin on purpose — same label, same field well, same
 * chevron, same bottom sheet with a handle and a tick on the chosen row — so a
 * shopper moving between State and Country does not meet two different
 * controls. What it adds is the one thing a 240-row list cannot do without:
 *
 *   · A SEARCH BOX. Scrolling to Zimbabwe past 230 other countries is not a
 *     list, it is a punishment. Typing is the primary way in, and the ranking
 *     lives in `lib/geo.ts` so "ni" puts Nigeria above Benin and "UAE" and
 *     "UK" find countries whose official names contain neither string.
 *   · VIRTUALISATION. `SelectField` maps its options inside a ScrollView,
 *     which is right for 37 states and would mount 240 rows here — a visible
 *     stall every time the sheet opens. A FlatList with a fixed row height
 *     renders a screenful.
 *   · It OPENS ON THE CURRENT COUNTRY rather than at the top, so the sheet
 *     answers "what is it now?" before it asks for a change.
 *
 * It does not know anything about regions or postcodes. Those labels come from
 * `regionLabel()` / `postcodeLabel()` in lib/geo.ts, and the screens apply
 * them — a control that silently relabelled its neighbours would be impossible
 * to follow from the screen's own source.
 */

/** Fixed so the list can be virtualised without measuring every row. */
const ROW_HEIGHT = 48;

export function CountryField({
  value,
  onChange,
  label = "Country",
  placeholder = "Select a country…",
  error,
  hint,
  style,
  account,
  bottomInset = 16,
}: {
  /** ISO 3166-1 alpha-2. Anything unrecognised still displays, as its code. */
  value: string;
  onChange: (code: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  /** A line under the field — e.g. what the country changes about delivery. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * The account area's scale: 9px/1.4 grey label and the borderless tinted
   * well, matching `Field` and `SelectField` from components/checkout-ui.tsx.
   */
  account?: boolean;
  /** Safe-area inset, so the sheet clears the home indicator. */
  bottomInset?: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const code = normalizeCountry(value);
  const chosen = (value ?? "").trim() ? countryName(code) : "";

  const results = useMemo(() => searchCountries(query), [query]);

  /**
   * Where to open the list. -1 (nothing chosen) must not reach FlatList, which
   * throws on a negative `initialScrollIndex`.
   */
  const startIndex = useMemo(() => {
    const i = COUNTRIES.findIndex((c) => c.code === code);

    return i > 0 ? i : undefined;
  }, [code]);

  function openSheet() {
    // A stale query would hide the current country behind someone else's
    // half-typed search from the last time this sheet was used.
    setQuery("");
    setOpen(true);
  }

  function pick(next: Country) {
    // A tap on the country that is ALREADY chosen is a dismissal, not a change.
    //
    // The sheet deliberately opens scrolled to the current country with a tick
    // on it, so tapping that row to confirm and close is the natural gesture —
    // and every screen using this control now clears the region and the postcode
    // on a country change. Firing `onChange` for an unchanged code therefore
    // silently emptied two filled boxes: a Nigerian shopper holding Lagos and
    // 106104 opened the sheet to check the country, tapped Nigeria, and lost
    // both — on the checkout it also dropped the delivery fee back to "—", and
    // on My details it left a save that could only fail. Nigeria is the shop's
    // dominant market, so this was the common path, not an edge case.
    if (next.code !== code) onChange(next.code);
    setOpen(false);
  }

  return (
    <View style={style}>
      <Text style={[styles.label, account && styles.labelAccount]}>{label.toUpperCase()}</Text>

      <Pressable
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${chosen || placeholder}`}
        style={({ pressed }) => [
          styles.field,
          account && styles.fieldAccount,
          Boolean(error) && { borderColor: theme.colors.danger },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text numberOfLines={1} style={[styles.input, !chosen && { color: theme.textInk.faint }]}>
          {chosen || placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>

      {error ? (
        <Txt tone="danger" size={11} style={{ marginTop: 5 }}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt tone="faint" size={11} style={{ marginTop: 5 }}>
          {hint}
        </Txt>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // Android resizes the window for the keyboard already; adding padding
          // on top of that lifts the sheet clean off the bottom of the screen.
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.scrim}
            onPress={() => setOpen(false)}
            accessibilityLabel={`Close ${label}`}
          />

          <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
            <View style={styles.handle} />
            <Txt tone="ink" display size={18}>
              {label}
            </Txt>

            <View style={styles.search}>
              <IconSearch width={16} height={16} color={theme.colors.primaryOn} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search countries…"
                placeholderTextColor={theme.textInk.faint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="never"
                accessibilityLabel="Search countries"
                style={styles.searchInput}
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={10}
                  style={({ pressed }) => [styles.clear, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.clearText}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            <FlatList
              data={results}
              keyExtractor={(c) => c.code}
              style={styles.list}
              initialScrollIndex={query ? undefined : startIndex}
              getItemLayout={(_, index) => ({
                length: ROW_HEIGHT,
                offset: ROW_HEIGHT * index,
                index,
              })}
              // Without this the first tap after typing only dismisses the
              // keyboard, so choosing a country takes two taps.
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Txt tone="faint" size={12} style={{ paddingVertical: 18, lineHeight: 18 }}>
                  No country matches “{query.trim()}”. Try the country’s own name, or its
                  two-letter code.
                </Txt>
              }
              renderItem={({ item }) => {
                const active = item.code === code && Boolean(chosen);

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.name}
                    onPress={() => pick(item)}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  >
                    <Txt
                      tone={active ? "primary" : "ink"}
                      size={14}
                      weight={active ? "medium" : "regular"}
                      numberOfLines={1}
                      style={{ flex: 1 }}
                    >
                      {item.name}
                    </Txt>
                    <Text style={styles.code}>{item.code}</Text>
                    {active ? <Text style={styles.tick}>✓</Text> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  /* The field. Identical to SelectField's, so the two read as one control. */
  label: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: t.textInk.soft,
    includeFontPadding: false,
  },
  labelAccount: { fontSize: 9, letterSpacing: 1.4, color: t.textInk.body },
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
  // The border is kept and painted the fill colour, exactly as in
  // checkout-ui: the control reads as borderless but can still be recoloured
  // for an error.
  fieldAccount: {
    borderRadius: 14,
    backgroundColor: t.surfaces.stepperTrack,
    borderColor: t.surfaces.stepperTrack,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: t.colors.ink, padding: 0 },
  chevron: { fontFamily: fonts.body, fontSize: 15, color: t.textInk.faint, marginTop: -5 },

  /* The sheet. */
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

  /**
   * The search well.
   *
   * Tinted rather than white: the account area's white search pill is drawn on
   * that area's tinted ground, and the same pill inside this white sheet would
   * be an invisible control.
   */
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 46,
    marginTop: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: t.surfaces.stepperTrack,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: t.colors.ink,
    padding: 0,
    // Android pads a field past its line height, which stops the well being
    // the height it is set to.
    includeFontPadding: false,
  },
  clear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.surfaces.segmentTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { fontFamily: fonts.medium, fontSize: 9, color: t.textInk.body },

  // Tall enough to show that it scrolls, short enough to leave the field it
  // came from on screen behind the sheet.
  list: { maxHeight: 380, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.lineSoft,
  },
  code: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  tick: { fontFamily: fonts.medium, fontSize: 14, color: t.colors.primaryOn },
});
