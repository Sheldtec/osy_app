import { router } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";

import { HairImage } from "@/components/hair-image";
import { AddCircle, IconHeart, IconHeartFilled, photoFor } from "@/components/icons";
import { Txt } from "@/components/ui";
import { useWishlist } from "@/lib/wishlist";
import { useApproxMoney } from "@/lib/currency-context";
import { displayPrice } from "@/lib/product-variant";
import type { Product } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * "Product Card" from the Featured section — white, radius 20, BORDERLESS;
 * photo bleeding to the card's top corners with the favourite circle over it
 * and the badge sitting on its lower edge.
 *
 * The surface follows the ACCOUNT area (components/account-ui.tsx), by owner
 * decision 2026-10-15: borderless radius-20 white on the tinted ground, so the
 * shop and the account no longer read as two different apps. This supersedes
 * the original radius-16 hairline-bordered card.
 *
 * The badge tint is the design's: solid clay for BEST SELLER, the same clay at
 * 68% for anything softer.
 */
/**
 * Memoised: a home shelf holds up to sixty of these, and eighteen shelves of
 * them re-rendering on every scroll frame is what made the list slow.
 */
export const ProductCard = memo(function ProductCard({
  product,
  width,
  onAdd,
}: {
  product: Product;
  width?: DimensionValue;
  onAdd?: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // NOT <Link asChild>: expo-router clones the child with its own `style`,
  // which silently drops this one — the card lost its width, border, radius
  // and shadow and rendered as bare text on the page background.
  const photo = photoFor(product.slug, product.image);
  const onSale = (product.discount_percent ?? 0) > 0;

  const { has, toggle } = useWishlist();
  // Reading money, not paying it — so it may be shown in the chosen currency.
  // The Add-to-bag total on the product page is NOT, because that one commits.
  const money = useApproxMoney();
  const saved = has(product.id);

  // The price of the variant the product page will open on, so the grid can
  // never quote a figure the page then contradicts. The server's own figure,
  // never recomputed here.
  const sells = displayPrice(product);

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: product.slug } })}
      accessibilityRole="link"
      accessibilityLabel={`${product.name}, ${money(sells)}`}
      style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.imageWrap}>
        <HairImage src={photo} seed={product.slug} alt={product.name} monogramSize={54} />

        {/* A real control now. It was a decorative glyph inside a View, so the
            heart on every card in the shop saved nothing. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? `Remove ${product.name} from saved pieces` : `Save ${product.name}`}
          hitSlop={10}
          onPress={(e) => {
            // The whole card is a link to the product; saving must not open it.
            e.stopPropagation();
            toggle(product);
          }}
          style={({ pressed }) => [
            styles.favourite,
            saved && styles.favouriteOn,
            pressed && { opacity: 0.7 },
          ]}
        >
          {/* A SOLID heart when saved, not a tinted outline.
              The tint never showed: icon-heart.svg hardcodes stroke="#241F27",
              so the colour prop was ignored and a saved piece looked exactly
              like an unsaved one. Filling it is also the stronger signal. */}
          {saved ? (
            <IconHeartFilled width={16} height={16} color={theme.colors.primaryOn} />
          ) : (
            <IconHeart width={16} height={16} color="#241F27" />
          )}
        </Pressable>

        {product.badge ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: product.badge === "BEST SELLER" ? "#C4966E" : "rgba(196,150,110,0.68)" },
            ]}
          >
            <Text style={styles.badgeText}>{product.badge}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Txt tone="strong" weight="medium" size={11} numberOfLines={2} style={styles.name}>
          {product.name}
        </Txt>
        {product.spec ? (
          <Txt tone="body" size={9} numberOfLines={1} style={{ marginTop: 3 }}>
            {product.spec}
          </Txt>
        ) : null}

        <View style={styles.priceRow}>
          <Txt tone="strong" display size={14} numberOfLines={1} style={styles.price}>
            {money(sells)}
          </Txt>
          {onSale ? (
            <Text style={styles.compareAt} numberOfLines={1}>
              {money(product.price)}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Add ${product.name} to bag`}
          style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]}
        >
          <AddCircle width={29} height={29} />
          <Text style={styles.plus}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    // The account area's card shape: radius 20 and BORDERLESS. Separation
    // comes from the page colour, not from a hairline — a 1px border is the
    // checkout idiom and made these read as form fields in a grid.
    borderRadius: 20,
  },
  // 184 × 178 in the frame — kept as a ratio so the card scales with the grid.
  //
  // The clipping lives HERE, not on the card: `overflow: "hidden"` on the card
  // would also clip its shadow on iOS, and the only thing that needs clipping
  // is the photo's top corners.
  imageWrap: {
    width: "100%",
    aspectRatio: 184 / 178,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  favourite: {
    position: "absolute",
    top: 13,
    right: 11,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  /** Saved: the well tints too, so the state reads before the glyph does. */
  favouriteOn: { backgroundColor: t.colors.primaryCont },
  badge: {
    position: "absolute",
    left: 3,
    bottom: 8,
    height: 20,
    paddingHorizontal: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.medium, fontSize: 7.5, color: "#FFFFFF" },
  body: { paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11 },
  // Two lines reserved so cards in a row stay the same height whether the
  // name wraps or not.
  name: { minHeight: 30 },
  // Never shrink: a truncated price ("₦110,0…") is worse than a truncated
  // strike-through beside it.
  price: { flexShrink: 0 },
  // Reserves the corner the absolutely-placed add button occupies, so a long
  // Naira figure never runs under it (the frame only ever showed "€129").
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    marginTop: 8,
    paddingRight: 34,
  },
  compareAt: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 9,
    color: t.colors.muted,
    textDecorationLine: "line-through",
  },
  add: {
    position: "absolute",
    right: 11,
    bottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    position: "absolute",
    fontFamily: fonts.body,
    fontSize: 15,
    color: "#FFFFFF",
    // The exported circle has the glyph baked out; centre the "+" over it.
    marginTop: -1,
  },
});
