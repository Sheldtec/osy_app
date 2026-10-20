import { Pressable, StyleSheet, Text, View } from "react-native";

import { Txt } from "@/components/ui";
import { naira } from "@/lib/format";
import {
  SEARCH_GROUP_LABELS,
  type ParsedQuery,
  type SearchFilterKey,
} from "@/lib/product-search";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, radius } from "@/theme/tokens";

/**
 * "Understood as" — how a typed sentence was read into filters.
 *
 * A search that silently reinterprets what you asked for is impossible to
 * correct, so every inferred filter is stated and individually removable, and
 * anything the parser had to drop or could not use is admitted rather than
 * hidden. This is the website's own band, in the app's chip language.
 *
 * The order the groups appear in is fixed rather than following whatever order
 * the server's filter map happened to serialise in: a chip row that reshuffles
 * itself between two near-identical searches is unreadable.
 */

const ORDER: SearchFilterKey[] = [
  "type",
  "length",
  "grade",
  "texture",
  "thickness",
  "source",
];

export function ParsedSearchChips({
  parsed,
  onRemove,
  onRemovePrice,
  onClear,
}: {
  parsed: ParsedQuery;
  onRemove: (key: SearchFilterKey, value: string) => void;
  onRemovePrice: () => void;
  onClear: () => void;
}) {
  const s = useThemedStyles(makeS);

  const chips = ORDER.flatMap((key) =>
    (parsed.filters[key] ?? []).map((value) => ({ key, value })),
  );
  const hasPrice = parsed.min !== null || parsed.max !== null;
  // Everything the parse could not honour, named plainly: a filter that
  // vanished without explanation reads as a broken search.
  const dropped = parsed.relaxed.filter((r) => r.group !== "Price");
  const widened = parsed.relaxed.some((r) => r.group === "Price");

  if (!chips.length && !hasPrice && !dropped.length && !widened && !parsed.ignored.length) {
    return null;
  }

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        {chips.length || hasPrice ? <Text style={s.lead}>UNDERSTOOD AS</Text> : null}

        {chips.map(({ key, value }) => (
          <Chip
            key={`${key}:${value}`}
            group={SEARCH_GROUP_LABELS[key]}
            label={value}
            onRemove={() => onRemove(key, value)}
          />
        ))}

        {hasPrice ? (
          <Chip
            // "Budget" when the figure came from a vague word ("cheap"), so a
            // number the shopper never typed is never quoted back as theirs.
            group={parsed.softPrice ? "Budget" : "Price"}
            // naira(), NOT the display-currency hook: this is a bound the
            // shopper typed and the server compares against in ₦. Converting
            // it would restate their own filter as a figure they did not set.
            label={priceLabel(parsed.min, parsed.max)}
            onRemove={onRemovePrice}
          />
        ) : null}

        {chips.length || hasPrice ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={8}
            style={({ pressed }) => [s.clear, pressed && { opacity: 0.6 }]}
          >
            <Txt tone="primary" weight="medium" size={11}>
              Clear
            </Txt>
          </Pressable>
        ) : null}
      </View>

      {dropped.length ? (
        <Txt tone="faint" size={11} style={s.note}>
          No exact match for {dropped.map((r) => r.label).join(", ")} — showing the
          closest results instead.
        </Txt>
      ) : null}
      {widened ? (
        <Txt tone="faint" size={11} style={s.note}>
          We also had to widen the budget to find anything.
        </Txt>
      ) : null}
      {parsed.ignored.length ? (
        <Txt tone="faint" size={11} style={s.note}>
          Not stocked / no effect: {parsed.ignored.join(", ")}
        </Txt>
      ) : null}
    </View>
  );
}

function priceLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${naira(min)} – ${naira(max)}`;
  if (max !== null) return `up to ${naira(max)}`;

  return `from ${naira(min ?? 0)}`;
}

function Chip({
  group,
  label,
  onRemove,
}: {
  group: string;
  label: string;
  onRemove: () => void;
}) {
  const s = useThemedStyles(makeS);

  return (
    <View style={s.chip}>
      <Text style={s.chipText} numberOfLines={1}>
        <Text style={s.chipGroup}>{group}: </Text>
        {label}
      </Text>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove filter ${group}: ${label}`}
        hitSlop={10}
        style={({ pressed }) => [s.chipX, pressed && { opacity: 0.5 }]}
      >
        <Text style={s.chipXGlyph}>×</Text>
      </Pressable>
    </View>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  wrap: { paddingHorizontal: layout.gutter, marginTop: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  lead: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    color: t.colors.gold2,
    includeFontPadding: false,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    paddingLeft: 10,
    paddingRight: 2,
    paddingVertical: 4,
    borderRadius: radius.chip,
    backgroundColor: t.colors.primaryCont,
  },
  // Purple that is READ, so primaryOn — the fill here is the pale tint, not
  // the brand purple, so there is no white on top to carry the contrast.
  chipText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },
  chipGroup: { fontFamily: fonts.body, color: t.textInk.faint },
  chipX: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  chipXGlyph: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: t.colors.primaryOn,
    includeFontPadding: false,
  },
  clear: { paddingHorizontal: 4, paddingVertical: 4 },
  note: { marginTop: 7, lineHeight: 16 },
});
