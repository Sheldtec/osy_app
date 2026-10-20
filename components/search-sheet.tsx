import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HairImage } from "@/components/hair-image";
import { IconClock, IconTrash, photoFor } from "@/components/icons";
import { SearchBar } from "@/components/search-bar";
import { Txt } from "@/components/ui";
import { useApproxMoney } from "@/lib/currency-context";
import {
  getProductSuggestions,
  suggestionPrice,
  type ParsedChip,
  type ProductSuggestion,
} from "@/lib/product-search";
import { useSearchHistory } from "@/lib/search-history";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, radius } from "@/theme/tokens";

/**
 * The search experience, as a full screen over the shop.
 *
 * The website puts this in a dropdown under the field; a phone cannot. The
 * shop's search pill is sticky inside a scrolling grid, so an absolutely
 * positioned panel would be clipped by the sticky header it hangs from and
 * would fight the keyboard for the lower half of the screen. A sheet that owns
 * the whole screen while you are searching is both the native idiom and the
 * only arrangement with room for recent searches, a parse preview and eight
 * product rows at once.
 *
 * ONE COMMIT SEAM. Everything that can start a search — the keyboard's search
 * key, a recent row, "see all results" — goes through `commit`. A product row
 * is the one exception and it still records the search that found it. When
 * voice search arrives (out of scope today: native speech recognition needs a
 * dev build, so it cannot work in Expo Go) it becomes one more caller of
 * `commit` and nothing else here changes.
 *
 * What it does NOT do is filter the grid as you type. The shop re-queries the
 * API on commit, so a sentence is parsed once, against the words the shopper
 * finished writing — not nine times against prefixes of them.
 */

/** The parser understands whole sentences; say so, or nobody tries one. */
const HINT = "Try “long curly wig under 200k” — describe the hair you want in your own words.";

export function SearchSheet({
  open,
  query,
  onClose,
  onSubmit,
  onOpenProduct,
}: {
  open: boolean;
  /** The shop's committed query, so reopening resumes where it left off. */
  query: string;
  onClose: () => void;
  /** A committed search. The shop parses it, runs it and logs it. */
  onSubmit: (term: string) => void;
  onOpenProduct: (slug: string) => void;
}) {
  const s = useThemedStyles(makeS);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const money = useApproxMoney();
  const history = useSearchHistory();

  const [text, setText] = useState(query);
  const [loading, setLoading] = useState(false);
  const [suggest, setSuggest] = useState<{
    products: ProductSuggestion[];
    total: number;
    parsed: ParsedChip[];
  }>({ products: [], total: 0, parsed: [] });

  // Reopening resumes the committed query rather than whatever was abandoned
  // last time, which is what the bar behind the sheet is showing.
  useEffect(() => {
    if (open) setText(query);
  }, [open, query]);

  const term = text.trim();
  const searching = term.length >= 2;

  // Type-ahead, debounced on top of the server's throttle. Each run aborts
  // the previous in-flight request, and the sequence number means a reply that
  // lands late can never overwrite a newer one even if the abort lost the race.
  const runRef = useRef(0);
  useEffect(() => {
    if (!open || !searching) {
      setSuggest({ products: [], total: 0, parsed: [] });
      setLoading(false);

      return;
    }

    setLoading(true);
    const mine = ++runRef.current;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      const res = await getProductSuggestions(term, ctrl.signal);
      if (runRef.current !== mine) return;
      setSuggest({ products: res.products, total: res.total, parsed: res.parsed ?? [] });
      setLoading(false);
    }, 200);

    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [open, searching, term]);

  /** The single way a search starts. */
  function commit(next: string) {
    const clean = next.trim();
    if (!clean) return;
    history.push(clean);
    onSubmit(clean);
    onClose();
  }

  function openProduct(p: ProductSuggestion) {
    // Remember what got them there — the search worked, even though it ended
    // on a product rather than a grid.
    if (term) history.push(term);
    onOpenProduct(p.slug);
    onClose();
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
        <View style={s.head}>
          <SearchBar
            value={text}
            onChangeText={setText}
            onSubmit={() => commit(text)}
            showFilter={false}
            autoFocus
            style={s.field}
          />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={10}
            style={({ pressed }) => [s.cancel, pressed && { opacity: 0.6 }]}
          >
            <Txt tone="primary" weight="medium" size={12}>
              Cancel
            </Txt>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* How the sentence is being read, live. Shown before the results
              because it explains them — and because a shopper who sees their
              words turned into the wrong facet can fix the sentence instead of
              wondering why the grid looks odd. */}
          {searching && suggest.parsed.length > 0 ? (
            <View style={s.parseRow}>
              <Text style={s.parseLead}>Searching for</Text>
              {suggest.parsed.map((p) => (
                <View key={`${p.param}:${p.value}`} style={s.parseChip}>
                  <Text style={s.parseChipText} numberOfLines={1}>
                    <Text style={s.parseChipGroup}>{p.group}: </Text>
                    {p.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {!searching ? (
            history.history.length > 0 ? (
              <>
                <View style={s.sectionRow}>
                  <Text style={s.section}>RECENT SEARCHES</Text>
                  <Pressable
                    onPress={history.clearAll}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all recent searches"
                    hitSlop={8}
                    style={({ pressed }) => [s.clearAll, pressed && { opacity: 0.6 }]}
                  >
                    <IconTrash width={14} height={14} color={t.textInk.faint} />
                    <Txt tone="faint" weight="medium" size={11}>
                      Clear all
                    </Txt>
                  </Pressable>
                </View>

                {history.history.map((entry) => (
                  <View key={entry} style={s.historyRow}>
                    <Pressable
                      onPress={() => commit(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={`Search again for ${entry}`}
                      style={({ pressed }) => [s.historyTap, pressed && { opacity: 0.6 }]}
                    >
                      <IconClock width={14} height={14} color={t.textInk.faint} />
                      <Txt tone="strong" size={13} numberOfLines={1} style={{ flex: 1 }}>
                        {entry}
                      </Txt>
                    </Pressable>
                    <Pressable
                      onPress={() => history.remove(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${entry} from recent searches`}
                      hitSlop={10}
                      style={({ pressed }) => [s.rowX, pressed && { opacity: 0.5 }]}
                    >
                      <Text style={s.rowXGlyph}>×</Text>
                    </Pressable>
                  </View>
                ))}

                <Txt tone="faint" size={11} style={s.hint}>
                  {HINT}
                </Txt>
              </>
            ) : (
              // Nothing to show yet, so teach the one thing that is not
              // obvious: this field takes sentences, not keywords.
              <View style={s.blank}>
                <Txt tone="strong" display size={17} center>
                  Search in your own words
                </Txt>
                <Txt tone="body" size={12} center style={s.blankBody}>
                  {HINT}
                </Txt>
              </View>
            )
          ) : null}

          {searching ? (
            <>
              {loading && suggest.products.length === 0 ? (
                <ActivityIndicator color={t.colors.primaryOn} style={{ marginTop: 32 }} />
              ) : null}

              {!loading && suggest.products.length === 0 ? (
                <View style={s.blank}>
                  <Txt tone="strong" display size={17} center>
                    No matches
                  </Txt>
                  <Txt tone="body" size={12} center style={s.blankBody}>
                    Nothing matches “{term}”. Try fewer words, or describe the
                    hair instead — length, texture and budget all work.
                  </Txt>
                </View>
              ) : null}

              {suggest.products.length > 0 ? (
                <Text style={[s.section, s.sectionAlone]}>PRODUCTS</Text>
              ) : null}

              {suggest.products.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => openProduct(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${money(suggestionPrice(p))}`}
                  style={({ pressed }) => [s.suggestRow, pressed && { opacity: 0.7 }]}
                >
                  {/* HairImage fills its parent absolutely, so the size and
                      the clipping live on this wrapper. */}
                  <View style={s.thumb}>
                    <HairImage
                      src={photoFor(p.slug, p.image)}
                      seed={p.slug}
                      alt={p.name}
                      monogramSize={22}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt tone="strong" size={13} numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt tone="faint" size={11} numberOfLines={1} style={{ marginTop: 2 }}>
                      {p.spec || p.category}
                    </Txt>
                  </View>
                  {/* Read-only, so the shopper's display currency applies —
                      nothing on this row is charged or compared. */}
                  <Txt tone="primary" display size={13}>
                    {money(suggestionPrice(p))}
                  </Txt>
                </Pressable>
              ))}

              {suggest.total > 0 ? (
                <Pressable
                  onPress={() => commit(term)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.seeAll, pressed && { opacity: 0.7 }]}
                >
                  <Txt tone="primary" weight="medium" size={12} numberOfLines={1}>
                    See all {suggest.total} {suggest.total === 1 ? "result" : "results"} for “
                    {term}”
                  </Txt>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const GUTTER = layout.gutter;

const makeS = (t: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surfaces.cart },
  head: { flexDirection: "row", alignItems: "center", paddingRight: GUTTER },
  // The bar carries its own horizontal gutter, so the Cancel link only needs
  // the gap between them.
  field: { flex: 1, marginRight: 4 },
  cancel: { paddingVertical: 8 },

  section: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: GUTTER,
    marginTop: 22,
    marginBottom: 6,
  },
  sectionAlone: { paddingHorizontal: GUTTER, marginTop: 18, marginBottom: 6 },
  clearAll: { flexDirection: "row", alignItems: "center", gap: 5 },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GUTTER,
  },
  // The tap target is the whole row minus the remove button, and 44 tall so
  // it is reachable with a thumb.
  historyTap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 44 },
  rowX: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  rowXGlyph: {
    fontFamily: fonts.body,
    fontSize: 19,
    color: t.textInk.faint,
    includeFontPadding: false,
  },

  parseRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: GUTTER,
    marginTop: 16,
  },
  parseLead: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1.6,
    color: t.colors.gold2,
    includeFontPadding: false,
  },
  parseChip: {
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.chip,
    backgroundColor: t.colors.primaryCont,
  },
  parseChipText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },
  parseChipGroup: { fontFamily: fonts.body, color: t.textInk.faint },

  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: GUTTER,
    paddingVertical: 8,
  },
  thumb: {
    width: 44,
    height: 56,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },

  seeAll: {
    marginTop: 10,
    marginHorizontal: GUTTER,
    height: 46,
    borderRadius: radius.control,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },

  hint: { paddingHorizontal: GUTTER, marginTop: 20, lineHeight: 17 },
  blank: { paddingHorizontal: 36, paddingTop: 56 },
  blankBody: { marginTop: 8, lineHeight: 18 },
});
