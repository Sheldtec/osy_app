import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  DEFAULT_FILTERS,
  FilterSheet,
  PRICE_BANDS,
  SORTS,
  activeFilterCount,
  type FilterState,
} from "@/components/filter-sheet";
import { NAV_CLEARANCE } from "@/components/glass-nav";
import { ChevronDown } from "@/components/icons";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/search-bar";
import { Txt } from "@/components/ui";
import { getFacets, getProducts } from "@/lib/api";
import { useCart } from "@/lib/cart";
import type { Category, Product, ProductFacets } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, radius } from "@/theme/tokens";

/**
 * Shop — Figma "Refined · 7 · Shop" (249:450).
 *
 * Title and subtitle, the elevated search pill, a category rail, the result
 * count paired with a sort control, then the 2-up grid.
 *
 * Things worth knowing:
 *
 *   · The search is a REAL query, debounced and sent as `?q=`, not a
 *     client-side filter over one page — that would search only what happened
 *     to be loaded and quietly miss the rest of a 124-product catalogue.
 *   · The count is `meta.total` from the API, not `items.length`. Those differ
 *     the moment the catalogue outgrows one page, and showing the page length
 *     as the total is simply wrong.
 *   · The category rail is built from the `Category` union in lib/types, not
 *     from the Home rail's five circles — Home includes "Curls", a texture
 *     rather than a catalogue category, which matches no product.
 */
const GUTTER = layout.gutter;
const PER_PAGE = 24;

/** Every catalogue category, in the frame's order. `null` is "All". */
/** A route param, narrowed to a real catalogue category (or All). */
function asCategory(key?: string): Category | null {
  return CATEGORIES.some((c) => c.key === key) ? (key as Category) : null;
}

const CATEGORIES: { key: Category | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "wigs", label: "Wigs" },
  { key: "bundles", label: "Bundles" },
  { key: "frontals", label: "Frontals" },
  { key: "closures", label: "Closures" },
];

export default function ShopScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();

  // Home's category tiles deep-link into Shop.
  //
  // This used to seed the state ONCE, in a useState initialiser. Shop is a
  // TAB, so once visited it stays mounted and that initialiser never ran
  // again — the first category tap from Home worked and every tap after it
  // silently did nothing. Reacting to the param is what makes the tiles work.
  //
  // Home stamps each tap with `at`, so choosing the same category twice is
  // still a new instruction: tap Wigs, clear it to All here, tap Wigs again
  // on Home, and it applies.
  const { category: routeCategory, at } = useLocalSearchParams<{
    category?: string;
    at?: string;
  }>();
  const [category, setCategory] = useState<Category | null>(() => asCategory(routeCategory));

  // What we have already acted on, so a re-render with the same params does
  // NOT undo a chip the shopper tapped here.
  const consumed = useRef<string | undefined>(undefined);

  useEffect(() => {
    const token = at ?? routeCategory;
    if (token === undefined || token === consumed.current) return;

    consumed.current = token;
    setCategory(asCategory(routeCategory));
  }, [at, routeCategory]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [facets, setFacets] = useState<ProductFacets | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Facet options come from the live catalogue, once.
  useEffect(() => {
    let alive = true;
    getFacets().then((f) => alive && setFacets(f));
    return () => {
      alive = false;
    };
  }, []);

  // Debounce the query so a request is not fired per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 280);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    const band = PRICE_BANDS.find((b) => b.key === filters.price);

    getProducts({
      ...(category ? { category } : {}),
      ...(debounced ? { q: debounced } : {}),
      sort: filters.sort,
      ...(band?.min ? { min: band.min } : {}),
      ...(band?.max ? { max: band.max } : {}),
      ...(filters.lengths.length ? { length: filters.lengths } : {}),
      ...(filters.grades.length ? { grade: filters.grades } : {}),
      ...(filters.laces.length ? { lace: filters.laces } : {}),
      ...(filters.textures.length ? { texture: filters.textures } : {}),
      per_page: PER_PAGE,
    })
      .then((page) => {
        if (!alive) return;
        setProducts(page.items);
        setTotal(page.total);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setProducts([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : "Could not load the catalogue.");
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [category, debounced, filters]);

  const cardWidth = (width - GUTTER * 2 - layout.gap) / 2;
  const sortLabel = useMemo(
    () => SORTS.find((s) => s.key === filters.sort)?.label ?? "Popular",
    [filters.sort],
  );
  const filterCount = activeFilterCount(filters);
  const searching = query.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaces.cart, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + NAV_CLEARANCE }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Index 1 is the search + category block: the title scrolls away, the
        // controls stay. Keep this in step if a sibling is added above it.
        stickyHeaderIndices={[1]}
      >
        <View style={{ paddingHorizontal: GUTTER }}>
          <Txt tone="strong" display size={27}>
            Shop
          </Txt>
          <Txt tone="body" size={11} style={{ marginTop: 6 }}>
            Curated premium hair collections
          </Txt>
        </View>

        {/* Search + categories PIN to the top (stickyHeaderIndices below).
            Over a 124-product grid, scrolling back to the top to change a
            category is the kind of friction that makes a shop feel homemade —
            and the controls were costing a quarter of the screen while adding
            nothing once you had scrolled past them. */}
        <View style={styles.sticky}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onFilter={() => setSheetOpen(true)}
            filterCount={filterCount}
            filterLabel="Filter and sort"
            style={{ marginTop: 14 }}
          />

          <View style={styles.railWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {CATEGORIES.map((c) => {
                const active = category === c.key;
                return (
                  <Pressable
                    key={c.label}
                    onPress={() => setCategory(c.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.pill,
                      active ? styles.pillActive : styles.pillIdle,
                      pressed && !active && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Right-edge fade. pointerEvents none so it never eats a tap on
                the chip beneath it. */}
            <LinearGradient
              pointerEvents="none"
              colors={[theme.surfaces.cartFade, theme.surfaces.cart]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.railFade}
            />
          </View>
        </View>

        <View style={styles.resultRow}>
          <Txt tone="strong" weight="medium" size={11} style={{ flex: 1 }}>
            {loading
              ? "Loading…"
              : `${total} product${total === 1 ? "" : "s"}${searching ? ` for “${query.trim()}”` : ""}`}
          </Txt>

          <Pressable
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sorted by ${sortLabel}. Change filters and sort`}
            style={({ pressed }) => [styles.sort, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.sortText} numberOfLines={1}>
              {sortLabel}
            </Text>
            <ChevronDown width={12} height={12} color={theme.textInk.strong} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 48 }} />
        ) : error ? (
          <View style={styles.empty}>
            <Txt tone="strong" display size={18} center>
              Could not load the catalogue
            </Txt>
            <Txt tone="body" size={12} center style={{ marginTop: 8, lineHeight: 18 }}>
              {error}
            </Txt>
            <Pressable
              onPress={() => setFilters((f) => ({ ...f }))}
              accessibilityRole="button"
              style={styles.emptyBtn}
            >
              <Txt tone="primary" weight="medium" size={12}>
                Try again
              </Txt>
            </Pressable>
          </View>
        ) : products.length === 0 ? (
          <Empty
            searching={searching}
            filtered={filterCount > 0 || category !== null}
            onClear={() => {
              setQuery("");
              setCategory(null);
              setFilters(DEFAULT_FILTERS);
            }}
          />
        ) : (
          <>
            <View style={styles.grid}>
              {products.map((p) => (
                <ProductCard key={p.id} product={p} width={cardWidth} onAdd={() => cart.add(p)} />
              ))}
            </View>

            {/* One page is all this screen loads. Say so rather than letting the
                grid look like the whole catalogue. */}
            {total > products.length ? (
              <Txt tone="body" size={11} center style={{ marginTop: 18 }}>
                Showing {products.length} of {total}. Narrow it down with filters or search.
              </Txt>
            ) : null}
          </>
        )}
      </ScrollView>

      <FilterSheet
        open={sheetOpen}
        value={filters}
        facets={facets}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/** Nothing matched — say which control to loosen. */
function Empty({
  searching,
  filtered,
  onClear,
}: {
  searching: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Txt tone="strong" display size={18} center>
        {searching ? "No matches" : "Nothing here yet"}
      </Txt>
      <Txt tone="body" size={12} center style={{ marginTop: 8, lineHeight: 18 }}>
        {searching
          ? "Try a shorter word, or browse a category instead."
          : filtered
            ? "No pieces match these filters right now."
            : "This category has no pieces in stock right now."}
      </Txt>
      <Pressable onPress={onClear} accessibilityRole="button" style={styles.emptyBtn}>
        <Txt tone="primary" weight="medium" size={12}>
          Clear filters
        </Txt>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  /**
   * The rail is sized from radius.chip, not from a hand-picked number.
   *
   * A chip radius of 17 describes a 34-tall fully-rounded chip; the rail was
   * drawn at 38 with a 19 radius, so it matched no token and read as a row of
   * oversized buttons with 10px labels adrift inside them. Height 34 with a 12px
   * medium label puts the text back in proportion to the shape holding it.
   */
  rail: {
    paddingLeft: GUTTER,
    // Room for the fade, so the last chip is never cut flush to the edge.
    paddingRight: GUTTER + 20,
    paddingTop: 14,
    gap: 8,
  },
  // A sticky header is lifted out of the scroll flow, so it needs its own
  // opaque background or the grid scrolls through it.
  sticky: { backgroundColor: t.surfaces.cart, paddingBottom: 2 },
  railWrap: { position: "relative" },
  /** Signals "this scrolls" — a clipped chip at a hard edge reads as broken. */
  railFade: { position: "absolute", right: 0, top: 0, bottom: 0, width: 36 },
  pill: {
    height: radius.chip * 2,
    paddingHorizontal: 15,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  // Solid white and BORDERLESS, like the account area's chips: the fill is the
  // edge. (It was a translucent white with a hairline; the translucency left
  // the row floating, and the hairline is the checkout idiom.)
  pillIdle: { backgroundColor: t.colors.surface },
  pillActive: { backgroundColor: t.colors.primary },
  pillText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: 0.1,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  pillTextActive: { color: "#FFFFFF" },

  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GUTTER,
    marginTop: 20,
    marginBottom: 12,
    gap: 12,
  },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 34,
    maxWidth: 168,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.colors.surface,
  },
  sortText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 10, color: t.textInk.strong },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: layout.gap,
    paddingHorizontal: GUTTER,
  },

  empty: { alignItems: "center", paddingHorizontal: 40, paddingTop: 56 },
  emptyBtn: {
    marginTop: 18,
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
