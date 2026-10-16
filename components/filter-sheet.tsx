import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { GradientButton, Txt } from "@/components/ui";
import { naira } from "@/lib/format";
import type { ProductFacets } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Filter & sort sheet, opened by the gradient button on the Shop search bar.
 *
 * The Figma file has no filter frame, so this is drawn in the same surface
 * language as the sort sheet it grew out of: a bottom sheet, sections with
 * pill chips, a reset link and one gradient action.
 *
 * The facet groups come from GET /products/facets — the live catalogue's own
 * lengths, grades, laces and textures with counts — so the sheet never offers
 * an option that matches nothing. A group the catalogue does not use is simply
 * not shown. Price is offered as bands rather than a slider: bands read
 * faster on a phone and map cleanly onto the API's ?min= / ?max=.
 */

export const SORTS = [
  { key: "featured", label: "Popular" },
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
  { key: "rating", label: "Top rated" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

/** Price bands in whole Naira. `null` bounds are open-ended. */
export const PRICE_BANDS = [
  { key: "any", label: "Any price", min: null, max: null },
  { key: "lt100", label: `Under ${naira(100_000)}`, min: null, max: 100_000 },
  { key: "100-180", label: `${naira(100_000)} – ${naira(180_000)}`, min: 100_000, max: 180_000 },
  { key: "180-250", label: `${naira(180_000)} – ${naira(250_000)}`, min: 180_000, max: 250_000 },
  { key: "gt250", label: `Over ${naira(250_000)}`, min: 250_000, max: null },
] as const;

export type PriceBandKey = (typeof PRICE_BANDS)[number]["key"];

export interface FilterState {
  sort: SortKey;
  price: PriceBandKey;
  lengths: string[];
  grades: string[];
  laces: string[];
  textures: string[];
}

export const DEFAULT_FILTERS: FilterState = {
  sort: "featured",
  price: "any",
  lengths: [],
  grades: [],
  laces: [],
  textures: [],
};

/** How many filters are active — for the badge on the button. Sort is not one. */
export function activeFilterCount(f: FilterState): number {
  return (
    (f.price === "any" ? 0 : 1) + f.lengths.length + f.grades.length + f.laces.length + f.textures.length
  );
}

export function FilterSheet({
  open,
  value,
  facets,
  onApply,
  onClose,
  bottomInset,
}: {
  open: boolean;
  value: FilterState;
  facets: ProductFacets | null;
  onApply: (next: FilterState) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const styles = useThemedStyles(makeStyles);
  // Edits are local until "Show results": closing the sheet discards them,
  // which is what people expect from a sheet with an explicit apply button.
  const [draft, setDraft] = useState<FilterState>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const toggle = (group: "lengths" | "grades" | "laces" | "textures", item: string) =>
    setDraft((d) => ({
      ...d,
      [group]: d[group].includes(item) ? d[group].filter((v) => v !== item) : [...d[group], item],
    }));

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close filters" />

      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
        <View style={styles.handle} />

        <View style={styles.head}>
          <Txt tone="strong" display size={20} style={{ flex: 1 }}>
            Filter &amp; sort
          </Txt>
          <Pressable
            onPress={() => setDraft(DEFAULT_FILTERS)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Txt tone="primary" weight="medium" size={12}>
              Reset
            </Txt>
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          <Group title="Sort by">
            {SORTS.map((s) => (
              <Pill
                key={s.key}
                label={s.label}
                selected={draft.sort === s.key}
                onPress={() => setDraft((d) => ({ ...d, sort: s.key }))}
              />
            ))}
          </Group>

          <Group title="Price">
            {PRICE_BANDS.map((b) => (
              <Pill
                key={b.key}
                label={b.label}
                selected={draft.price === b.key}
                onPress={() => setDraft((d) => ({ ...d, price: b.key }))}
              />
            ))}
          </Group>

          {facets?.lengths.length ? (
            <Group title="Length">
              {facets.lengths.map((f) => (
                <Pill
                  key={f.value}
                  label={f.value}
                  count={f.count}
                  selected={draft.lengths.includes(f.value)}
                  onPress={() => toggle("lengths", f.value)}
                />
              ))}
            </Group>
          ) : null}

          {facets?.grades.length ? (
            <Group title="Grade">
              {facets.grades.map((f) => (
                <Pill
                  key={f.value}
                  label={f.value}
                  count={f.count}
                  selected={draft.grades.includes(f.value)}
                  onPress={() => toggle("grades", f.value)}
                />
              ))}
            </Group>
          ) : null}

          {facets?.laces.length ? (
            <Group title="Lace">
              {facets.laces.map((f) => (
                <Pill
                  key={f.value}
                  label={f.value}
                  count={f.count}
                  selected={draft.laces.includes(f.value)}
                  onPress={() => toggle("laces", f.value)}
                />
              ))}
            </Group>
          ) : null}

          {facets?.textures.length ? (
            <Group title="Texture">
              {facets.textures.map((f) => (
                <Pill
                  key={f.value}
                  label={f.value}
                  count={f.count}
                  selected={draft.textures.includes(f.value)}
                  onPress={() => toggle("textures", f.value)}
                />
              ))}
            </Group>
          ) : null}
        </ScrollView>

        <GradientButton
          label={
            activeFilterCount(draft) ? `Show results · ${activeFilterCount(draft)} filter${activeFilterCount(draft) === 1 ? "" : "s"}` : "Show results"
          }
          height={54}
          style={{ marginTop: 16 }}
          onPress={() => onApply(draft)}
        />
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Pill({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.pill,
        selected ? styles.pillActive : styles.pillIdle,
        pressed && !selected && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.pillText, selected && styles.pillTextActive]}>
        {label}
        {count !== undefined ? <Text style={[styles.count, selected && styles.countActive]}>  {count}</Text> : null}
      </Text>
    </Pressable>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(20,12,26,0.34)" },
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.surfaces.handle, alignSelf: "center" },
  head: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  groupTitle: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 1.2, color: t.textInk.body },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pillIdle: { backgroundColor: t.colors.surface, borderColor: t.surfaces.lineProduct },
  pillActive: { backgroundColor: t.colors.primary, borderColor: t.colors.primaryOn },
  pillText: { fontFamily: fonts.medium, fontSize: 11, color: t.textInk.strong },
  pillTextActive: { color: "#FFFFFF" },
  count: { fontFamily: fonts.body, fontSize: 10, color: t.textInk.faint },
  countActive: { color: "rgba(255,255,255,0.75)" },
});
