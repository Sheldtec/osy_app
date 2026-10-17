import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NAV_CLEARANCE } from "@/components/glass-nav";
import {
  BadgeDot,
  CatBundles,
  CatClosures,
  CatCurls,
  CatFrontals,
  CatWigs,
  HeroGlow,
  HeroGold1,
  HeroGold2,
  HeroGold3,
  IconArrow,
  IconBag,
  IconFavorite,
  IconTryOn,
  NavProfile,
  PHOTOS,
} from "@/components/icons";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/search-bar";
import { Txt } from "@/components/ui";
import { ApiUnavailableError, getProducts } from "@/lib/api";
import { buildHome, SHELF_PAGE, type HomePlan, type Shelf } from "@/lib/home-shelves";
import { easeOut, motion, useReducedMotion } from "@/lib/motion";
import { useScrollReveal } from "@/lib/scroll-reveal";
import type { Product } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useStorefrontSettings } from "@/lib/settings";
import { useCart } from "@/lib/cart";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, heroSlides, layout } from "@/theme/tokens";

/**
 * Home — Figma "Refined · 1 · Home" (275:2).
 *
 * Order is the frame's: header → elevated search → category rail → hero
 * carousel → product shelves → (floating nav, drawn by the layout).
 *
 * Home used to fetch four products and stop. It now renders the shop as a
 * sequence of COLLECTIONS — each one a real query with its own products —
 * revealed a few at a time as you scroll, each fetching its own page. The
 * manifest is built at runtime in lib/home-shelves.ts from the admin's
 * curated collections and the live facet counts, so it tracks the catalogue
 * instead of drifting from it.
 *
 * Two things this deliberately does NOT do:
 *   · pad a thin collection to reach twenty, and
 *   · build shelves out of catalogue-wide SORTS beyond the two the admin
 *     configured — "featured" and "highest rated" are the same 124 products in
 *     a different order, so shelving both shows the customer the same hair
 *     twice under two headings.
 *
 * The frame positions everything absolutely at a 440pt width; this lays it out
 * with flex so it holds its proportions on a 390pt phone too.
 */

const GUTTER = layout.gutter;
/** Scroll offset past which the search bar is pinned (the header's height). */
const STICKY_AT = 44;
/** Collections revealed per scroll-to-bottom. */
const REVEAL_STEP = 3;
/** Collections rendered before the first scroll. */
const REVEAL_FIRST = 3;

const CATEGORY_ICONS = {
  wigs: CatWigs,
  bundles: CatBundles,
  closures: CatClosures,
  frontals: CatFrontals,
  curls: CatCurls,
} as const;

const HERO = [
  {
    badge: "NEW COLLECTION",
    title: ["Everyday luxury.", "Made for you."],
    caption: ["Premium human hair, crafted", "for effortless confidence."],
    cta: "Explore collection",
    tag: "12A GRADE",
    photo: PHOTOS.hero1,
    Gold: HeroGold1,
  },
  {
    badge: "BEST SELLERS",
    title: ["Soft texture.", "Bold presence."],
    caption: ["Customer favourites selected", "for polished everyday styling."],
    cta: "Shop best sellers",
    tag: "HD LACE",
    photo: PHOTOS.hero2,
    Gold: HeroGold2,
  },
  {
    badge: "NEW ARRIVALS",
    title: ["Your style.", "Your signature."],
    caption: ["Fresh silhouettes designed", "for confident, easy wear."],
    cta: "Discover new",
    tag: "GLUELESS",
    photo: PHOTOS.hero3,
    Gold: HeroGold3,
  },
] as const;

/**
 * Loaded products, kept across unmounts.
 *
 * A shelf that scrolls out of the list's render window unmounts, and without
 * this it would refetch — and, worse, return null for a frame while it did,
 * collapsing its own height and jerking the content under the reader's thumb.
 * Seeded from the useState INITIALISER so a remounted shelf paints its rows on
 * its very first frame.
 */
interface ShelfData {
  items: Product[];
  /** The server's count for this query — the truth behind the header. */
  total: number;
  /** Highest page fetched. 0 means nothing yet. */
  page: number;
  done: boolean;
}
const shelfCache = new Map<string, ShelfData>();

export default function HomeScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [cursor, setCursor] = useState(REVEAL_FIRST);
  const [planning, setPlanning] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stuck, setStuck] = useState(false);
  const reveal = useScrollReveal();

  const contentWidth = width - GUTTER * 2;
  // Narrower than a grid cell so the next card peeks — the only honest signal
  // that a rail scrolls, short of drawing an arrow over it.
  const cardWidth = Math.round(contentWidth * 0.46);

  /**
   * Content height at which we last revealed a batch.
   *
   * The scroll handler runs on every frame, so it needs to fire at most once
   * per batch or one flick to the bottom would reveal the entire manifest.
   * Keying on content height gives exactly that: revealing extends the list,
   * which changes the height, which arms the next reveal.
   */
  // -1, not 0: onContentSizeChange may not have run when the first
  // onEndReached arrives, so the height it reports is still 0 — and a guard
  // seeded at 0 would reject that first call and never reveal anything.
  const revealedAt = useRef(-1);
  /** Latest measured content height, for triggers that are not given one. */
  const contentHeight = useRef(0);

  const load = useCallback(async () => {
    setPlanning(true);
    setBootError(null);
    try {
      const next = await buildHome();
      setPlan(next);
      setCursor(REVEAL_FIRST);
      revealedAt.current = -1;
    } catch (e: unknown) {
      setBootError(e instanceof Error ? e.message : "Could not load the shop.");
    } finally {
      setPlanning(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    shelfCache.clear();
    await load();
    setRefreshing(false);
  }, [load]);

  const shelves = plan?.shelves ?? [];
  const visible = useMemo(() => shelves.slice(0, cursor), [shelves, cursor]);
  const more = cursor < shelves.length;

  const revealMore = useCallback(
    (contentHeight: number) => {
      if (contentHeight === revealedAt.current) return;
      revealedAt.current = contentHeight;
      setCursor((c) => (c < shelves.length ? c + REVEAL_STEP : c));
    },
    [shelves.length],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;

      const next = contentOffset.y > STICKY_AT;
      // Only when it CHANGES — setting state on every frame of a scroll would
      // re-render the whole list sixty times a second.
      setStuck((was) => (was === next ? was : next));

      // The concierge bubble steps aside while you move down the page. Reported
      // from inside the handler this screen already has, rather than attaching a
      // second onScroll — a list takes only one.
      reveal.report(contentOffset.y);

      // Two independent triggers, one guard.
      //
      // onEndReached alone wedges: VirtualizedList fires it at most ONCE per
      // content length and re-arms only after you scroll back out of the end
      // zone, so reaching the bottom reveals one batch and then stops —
      // measured, the list sat at six collections with more behind a spinner.
      // This handler has no such latch. Between them one of the two always
      // fires, and `revealedAt` keeps either from running away.
      const distanceFromEnd =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceFromEnd < layoutMeasurement.height) revealMore(contentSize.height);
    },
    [revealMore, reveal],
  );

  /**
   * A stable element, not an inline component.
   *
   * `ListHeaderComponent={() => <X/>}` creates a new component type on every
   * render, which remounts the header — and the hero carousel would snap back
   * to slide 1 mid-swipe every time a shelf finished loading.
   */
  const header = useMemo(
    () => <HomeHeader contentWidth={contentWidth} categories={plan?.categories ?? []} />,
    [contentWidth, plan?.categories],
  );

  /** The very first shelf failing is how the app reports a dead backend. */
  const onShelfFail = useCallback((shelf: Shelf, message: string) => {
    if (shelf.id === shelves[0]?.id) setBootError(message);
  }, [shelves]);

  // A stable callback so memo(ShelfRow) can actually skip work. Inline here,
  // every shelf — and every card in its rail — re-rendered on each scroll
  // state change; RN logged the list as slow to update because of it.
  const renderShelf = useCallback(
    ({ item }: { item: Shelf }) => (
      <ShelfRow
        shelf={item}
        cardWidth={cardWidth}
        contentWidth={contentWidth}
        reduced={reduced}
        onFail={onShelfFail}
      />
    ),
    [cardWidth, contentWidth, reduced, onShelfFail],
  );

  if (planning && !plan) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.surfaces.cart, paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (bootError) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.surfaces.cart, paddingTop: insets.top }]}>
        <Txt tone="strong" weight="medium" size={14} center>
          Could not load products
        </Txt>
        <Txt tone="body" size={12} center style={{ marginTop: 6, lineHeight: 18, paddingHorizontal: 32 }}>
          {bootError}
        </Txt>
        <Pressable onPress={() => void load()} accessibilityRole="button" style={{ marginTop: 14 }}>
          <Txt tone="primary" weight="medium" size={12}>
            Try again
          </Txt>
        </Pressable>
      </View>
    );
  }

  return (
    // The safe-area inset lives on the OUTER view, so the pinned search bar
    // sits below the status bar rather than under it. The overlay below uses
    // top: 0 for the same reason — an absolutely-positioned child is laid out
    // from its parent's PADDING edge, so top: insets.top would double it.
    <View style={{ flex: 1, backgroundColor: theme.surfaces.cart, paddingTop: insets.top }}>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        renderItem={renderShelf}
        ListHeaderComponent={header}
        ListFooterComponent={
          <HomeFooter more={more} count={shelves.length} />
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => {
          contentHeight.current = h;
        }}
        onEndReached={() => revealMore(contentHeight.current)}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + NAV_CLEARANCE }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
      />

      {/* Pinned search — fades in once the header has scrolled away. */}
      <PinnedSearch visible={stuck} reduced={reduced} />
    </View>
  );
}

/** The scroll-away chrome: header row, search, categories, hero. */
const HomeHeader = memo(function HomeHeader({
  contentWidth,
  categories,
}: {
  contentWidth: number;
  categories: HomePlan["categories"];
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const cart = useCart();
  const { user } = useAuth();
  const { features } = useStorefrontSettings();

  return (
    <View>
      <View style={styles.header}>
        {/* The avatar, not a hamburger.
            It replaces a menu button that had no onPress at all — a control
            that looked tappable and did nothing. Now it is the way into
            Profile, which is what it needs to be since Profile left the bottom
            bar. Signed out, it goes to sign-in. */}
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={user ? "Your profile" : "Sign in"}
          onPress={() => router.push(user ? "/profile" : "/auth")}
        >
          {user?.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.headerAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              {user ? (
                <Text style={styles.headerAvatarText}>
                  {user.name.trim().charAt(0).toUpperCase() || "?"}
                </Text>
              ) : (
                <NavProfile width={17} height={17} color={theme.textInk.faint} />
              )}
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }} />

        {/* Try-on sits beside the wishlist because the two are the same kind of
            act — "could this be mine?" — and it is useless buried in Profile.
            It is hidden entirely when the owner switches the app's studio off,
            and while the flag is still unknown: a control that appears a beat
            late is better than one that appears and then vanishes. */}
        {features.face_match_app ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Try it on with AI"
            onPress={() => router.push("/try-on")}
          >
            <IconTryOn width={24} height={24} color={theme.textInk.strong} />
          </Pressable>
        ) : null}

        {/* This had no onPress at all — the third dead control found in this
            header's history, after the hamburger and the Help centre row. */}
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Saved items"
          onPress={() => router.push("/account/wishlist")}
          style={features.face_match_app ? { marginLeft: 18 } : undefined}
        >
          <IconFavorite width={24} height={24} color={theme.textInk.strong} />
        </Pressable>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Bag, ${cart.count} item${cart.count === 1 ? "" : "s"}`}
          onPress={() => router.push("/cart")}
          style={{ marginLeft: 18 }}
        >
          <IconBag width={24} height={24} color={theme.textInk.strong} />
        </Pressable>
      </View>

      <SearchBar onPress={() => router.push("/shop")} style={{ marginTop: 8 }} />

      <CategoryRail categories={categories} />

      <HeroCarousel width={contentWidth} />
    </View>
  );
});

function PinnedSearch({ visible, reduced }: { visible: boolean; reduced: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: reduced ? 0 : motion.fast,
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade, visible, reduced]);

  return (
    <Animated.View
      style={[
        styles.pinned,
        { opacity: fade, pointerEvents: visible ? "auto" : "none" },
      ]}
    >
      <SearchBar onPress={() => router.push("/shop")} />
    </Animated.View>
  );
}

function HomeFooter({ more, count }: { more: boolean; count: number }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (more) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!count) return null;

  return (
    <View style={styles.footer}>
      <Txt tone="body" size={11} center>
        {`That's all ${count} collections`}
      </Txt>
    </View>
  );
}

/**
 * One collection: a heading with its true size, and a rail of its products.
 *
 * The rail loads a page at a time and keeps loading as it is swiped, so a
 * seventy-two-piece collection is genuinely seventy-two pieces deep rather
 * than a fixed twenty with the rest hidden.
 */
const ShelfRow = memo(function ShelfRow({
  shelf,
  cardWidth,
  contentWidth,
  reduced,
  onFail,
}: {
  shelf: Shelf;
  cardWidth: number;
  contentWidth: number;
  reduced: boolean;
  onFail: (shelf: Shelf, message: string) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const cart = useCart();

  // Seeded in the initialiser, not an effect — see shelfCache.
  const [data, setData] = useState<ShelfData>(
    () =>
      shelfCache.get(shelf.id) ?? {
        items: [],
        total: shelf.total ?? 0,
        page: 0,
        done: false,
      },
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(shelfCache.has(shelf.id) ? 1 : 0)).current;

  const fetchPage = useCallback(
    async (page: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getProducts({ ...shelf.query, page, per_page: SHELF_PAGE });

        setData((prev) => {
          // Dedupe on append. `newest` and `price_asc` have no tiebreaker
          // server-side, so rows with equal values can genuinely reappear on
          // the next page — which would be a duplicated card and a duplicate
          // React key, not a padded shelf, but it looks like one.
          const seen = new Set(prev.items.map((p) => p.id));
          const fresh = res.items.filter((p) => !seen.has(p.id));
          const items = page === 1 ? res.items : [...prev.items, ...fresh];

          const next: ShelfData = {
            items,
            total: res.total,
            page,
            done: page >= res.lastPage || items.length >= res.total || fresh.length === 0,
          };
          shelfCache.set(shelf.id, next);
          return next;
        });
      } catch (e: unknown) {
        const message =
          e instanceof ApiUnavailableError || e instanceof Error
            ? e.message
            : "Could not load this collection.";
        setError(message);
        if (page === 1) onFail(shelf, message);
      } finally {
        setLoading(false);
      }
    },
    [shelf, onFail],
  );

  useEffect(() => {
    if (data.page === 0 && !loading && !error) void fetchPage(1);
    // Only on mount / shelf change — paging is driven by the rail's end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf.id]);

  useEffect(() => {
    if (!data.items.length) return;
    const animation = Animated.timing(fade, {
      toValue: 1,
      duration: reduced ? 0 : motion.base,
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade, data.items.length, reduced]);

  const loadMore = useCallback(() => {
    if (loading || data.done || error || data.page === 0) return;
    void fetchPage(data.page + 1);
  }, [loading, data.done, data.page, error, fetchPage]);

  // A rail that renders nothing must still occupy its height: a zero-height
  // cell leaves the list's content length unchanged, which is the exact signal
  // VirtualizedList uses to decide it may ask for more — so collapsing here
  // wedges the whole screen's pagination.
  const railHeight = Math.round(cardWidth * (178 / 184)) + 78;

  const count = data.total || shelf.total || 0;

  // The size is always shown, subtitle or not. It is the one number that says
  // how deep a collection really is, and a curated shelf with three pieces in
  // it should say three rather than hide behind its tagline.
  const size = count ? `${count} ${count === 1 ? "piece" : "pieces"}` : "Loading…";
  const tagline = shelf.subtitle?.trim().replace(/[.\s]+$/, "");
  const subline = tagline ? `${tagline} · ${size}` : size;

  return (
    <View style={styles.shelf}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Txt tone="strong" display size={20} numberOfLines={1}>
            {shelf.title}
          </Txt>
          <Txt tone="body" size={11} style={{ marginTop: 5 }} numberOfLines={1}>
            {subline}
          </Txt>
        </View>
      </View>

      {error && !data.items.length ? (
        <View style={[styles.railFallback, { height: railHeight }]}>
          <Txt tone="body" size={12} center>
            Couldn&apos;t load this collection.
          </Txt>
          <Pressable
            onPress={() => void fetchPage(1)}
            accessibilityRole="button"
            style={{ marginTop: 10 }}
          >
            <Txt tone="primary" weight="medium" size={12}>
              Retry
            </Txt>
          </Pressable>
        </View>
      ) : !data.items.length ? (
        <View style={[styles.railFallback, { height: railHeight }]}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <Animated.View style={{ opacity: fade }}>
          <FlatList
            horizontal
            data={data.items}
            keyExtractor={(p) => `${shelf.id}:${p.id}`}
            renderItem={({ item }) => (
              <ProductCard product={item} width={cardWidth} onAdd={() => cart.add(item)} />
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.railContent}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loading ? (
                <View style={[styles.railMore, { width: contentWidth * 0.3 }]}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              ) : null
            }
          />
        </Animated.View>
      )}
    </View>
  );
});

/**
 * The photograph that fronts each category.
 *
 * Bundled with the app rather than fetched: this is the shop's chrome, not a
 * product record, so it must render instantly, offline, and without depending
 * on a product surviving. The same four images front the categories on the
 * website (lib/category-media.ts), so the two storefronts agree.
 */
const CATEGORY_COVERS: Record<string, number> = {
  wigs: require("@/assets/categories/wigs.jpg"),
  bundles: require("@/assets/categories/bundles.jpg"),
  frontals: require("@/assets/categories/frontals.webp"),
  closures: require("@/assets/categories/closures.webp"),
};

/**
 * The circular category thumbnails.
 *
 * Sourced from the live facets, so it stops offering a category with nothing in
 * it. Tapping one used to set a state nothing read — the most prominent control
 * on Home did nothing at all.
 *
 * They are THUMBNAILS, as the frame specifies: a photograph inside the circle,
 * with a gold ring and the label beneath. The outlined circles holding a small
 * line glyph that stood here were a wireframe placeholder — nearly empty, hard
 * to tell apart, and reading as unfinished next to real product photography a
 * few hundred pixels below.
 *
 * The row LAYS OUT TO FILL THE WIDTH when everything fits, and only scrolls
 * when it genuinely cannot. Three fixed-width items left-aligned in a 375pt row
 * left a third of the screen empty, which looks like a loading state rather
 * than a design.
 */
function CategoryRail({ categories }: { categories: HomePlan["categories"] }) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  if (!categories.length) return null;

  // Four is the most that sits comfortably across a 375pt screen at this size.
  const fits = categories.length <= 4;

  const items = categories.map((cat) => {
    const cover = CATEGORY_COVERS[cat.key];
    const Icon = CATEGORY_ICONS[cat.key as keyof typeof CATEGORY_ICONS] ?? CatWigs;

    return (
      <Pressable
        key={cat.key}
        onPress={() =>
          // `at` stamps the tap, so Shop treats choosing the same category
          // twice as two instructions rather than one stale param.
          router.push({
            pathname: "/shop",
            params: { category: cat.key, at: String(Date.now()) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`${cat.label}, ${cat.count} pieces`}
        style={[styles.railItem, fits && styles.railItemFlex]}
      >
        <View style={styles.railTile}>
          {cover ? (
            <Image source={cover} style={styles.railImage} contentFit="cover" transition={150} />
          ) : (
            // A category we have no photograph for still gets a real tile
            // rather than a hole — the glyph on the tinted fill it always had.
            <View style={[styles.railImage, styles.railGlyph]}>
              <Icon width={26} height={26} color={theme.textInk.soft} />
            </View>
          )}

          {/* A scrim, not a flat bar: the label needs a guaranteed contrast
              floor over photographs whose brightness we do not control, and a
              hard-edged band across the bottom of every tile would read as a
              caption strip rather than part of the image. */}
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(26,20,32,0)", "rgba(26,20,32,0.78)"]}
            start={{ x: 0.5, y: 0.35 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.railScrim}
          />
          <Text style={styles.railLabel} numberOfLines={1}>
            {cat.label}
          </Text>
        </View>
      </Pressable>
    );
  });

  if (fits) return <View style={styles.railRow}>{items}</View>;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {items}
    </ScrollView>
  );
}

/** "Hero/Swipe Carousel" — three paging gradient slides with dot pagination. */
function HeroCarousel({ width }: { width: number }) {
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  return (
    <View style={[styles.hero, { width }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {HERO.map((slide, i) => {
          const stops = heroSlides[i];
          const Gold = slide.Gold;

          return (
            <LinearGradient
              key={slide.badge}
              colors={[stops.from, stops.mid, stops.to]}
              locations={[0, 0.58, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.7 }}
              style={[styles.heroSlide, { width }]}
            >
              <HeroGlow width={190} height={190} style={styles.heroGlow} />
              <Gold width={94} height={94} style={styles.heroGold} />

              <Image
                source={slide.photo}
                contentFit="cover"
                cachePolicy="memory-disk"
                style={styles.heroPhoto}
                accessibilityLabel={slide.title.join(" ")}
              />

              <View style={styles.heroBadge}>
                <BadgeDot width={6} height={6} />
                <Text style={styles.heroBadgeText}>{slide.badge}</Text>
              </View>

              {/* One Text per block, line-broken internally. Two stacked Texts
                  each carry their own box height, which on Android overflowed
                  the 124pt gap the frame leaves and ran the title into the
                  caption. */}
              <Text style={styles.heroTitleText}>{slide.title.join("\n")}</Text>
              <Text style={styles.heroCaptionText}>{slide.caption.join("\n")}</Text>

              <Pressable
                onPress={() => router.push("/shop")}
                accessibilityRole="button"
                style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.heroCtaText}>{slide.cta}</Text>
                <IconArrow width={15} height={15} />
              </Pressable>

              <View style={styles.heroTag}>
                <Text style={styles.heroTagText}>{slide.tag}</Text>
              </View>
            </LinearGradient>
          );
        })}
      </ScrollView>

      <View style={[styles.dots, { pointerEvents: "none" }]}>
        {HERO.map((slide, i) => (
          <View
            key={slide.badge}
            style={[
              styles.dot,
              i === index
                ? { width: 16, backgroundColor: "#FFFFFF" }
                : { width: 6, backgroundColor: "rgba(255,255,255,0.42)" },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  /** The header avatar that replaced the hamburger. Gold-ringed, like the frame's. */
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: t.colors.gold1,
    backgroundColor: t.colors.imgBg,
  },
  headerAvatarFallback: { alignItems: "center", justifyContent: "center" },
  headerAvatarText: { fontFamily: fonts.medium, fontSize: 13, color: t.colors.primaryOn },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GUTTER,
    height: 40,
  },

  pinned: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 10,
    backgroundColor: t.surfaces.cart,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.line,
  },

  rail: { paddingHorizontal: GUTTER, paddingTop: 18, gap: 16 },
  /** The fits-on-screen case: spread evenly instead of bunching to the left. */
  railRow: {
    flexDirection: "row",
    paddingHorizontal: GUTTER,
    paddingTop: 18,
    gap: 12,
  },
  railItem: { width: 118 },
  railItemFlex: { width: undefined, flex: 1 },
  /**
   * An image TILE, not a circular thumbnail.
   *
   * A 68px circle of a model shot showed a fragment of a face and told you
   * nothing about the category — the picture was decoration that happened to
   * cost a network image. A 4:3 tile is large enough for the hair itself to be
   * the subject, which is the only reason to use a photograph here at all.
   */
  railTile: {
    height: 86,
    // Matches the product card's radius, so the two things that sit on this
    // page in a row are the same shape.
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
    justifyContent: "flex-end",
  },
  railImage: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  /** Named for the glyph, not "fallback" — `railFallback` is already taken. */
  railGlyph: { alignItems: "center", justifyContent: "center" },
  railScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 48 },
  railLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: 0.2,
    color: "#FFFFFF",
    paddingHorizontal: 10,
    paddingBottom: 8,
    includeFontPadding: false,
  },

  hero: {
    height: 220,
    marginTop: 18,
    marginHorizontal: GUTTER,
    borderRadius: 24,
    overflow: "hidden",
  },
  heroSlide: { height: 220, overflow: "hidden" },
  heroGlow: { position: "absolute", right: -44, top: -78 },
  heroGold: { position: "absolute", left: "43%", top: 158 },
  heroPhoto: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 168,
    height: 196,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  heroBadge: {
    position: "absolute",
    left: 18,
    top: 18,
    height: 24,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  heroBadgeText: {
    fontFamily: fonts.medium,
    fontSize: 8,
    letterSpacing: 0.64,
    color: "#FFFFFF",
  },
  // Geometry straight from the frame: title 190x60 at (18,56), caption
  // 180x32 at (18,124). Fixed heights, so neither can push into the other.
  heroTitleText: {
    position: "absolute",
    left: 18,
    top: 56,
    width: 190,
    height: 60,
    fontFamily: fonts.display,
    fontSize: 23,
    lineHeight: 28,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  heroCaptionText: {
    position: "absolute",
    left: 18,
    top: 124,
    width: 180,
    height: 32,
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: "rgba(255,255,255,0.76)",
    includeFontPadding: false,
  },
  heroCta: {
    position: "absolute",
    left: 18,
    top: 169,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroCtaText: { fontFamily: fonts.medium, fontSize: 9.5, color: "#541A7A" },
  heroTag: {
    position: "absolute",
    right: 40,
    top: 171,
    height: 24,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
  },
  heroTagText: {
    fontFamily: fonts.medium,
    fontSize: 8,
    letterSpacing: 0.64,
    color: "#4F1770",
  },
  dots: {
    position: "absolute",
    bottom: 7,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: { height: 6, borderRadius: 3 },

  shelf: { marginTop: 26 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: GUTTER,
  },
  railContent: {
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    gap: layout.gap,
    alignItems: "flex-start",
  },
  railFallback: {
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  railMore: { alignItems: "center", justifyContent: "center" },

  footer: { paddingTop: 30, paddingBottom: 10, alignItems: "center" },
});
