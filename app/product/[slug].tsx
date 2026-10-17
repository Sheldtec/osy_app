import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HairImage } from "@/components/hair-image";
import {
  ChevronRight,
  IconBack,
  IconBagWhite,
  IconHeartOutline,
  IconHeartOutlineFilled,
  IconShield,
  IconShipped,
  IconTryOn,
  IconVerified,
  PdpArc,
  photoFor,
} from "@/components/icons";
import { Chip, CircleButton, GradientButton, Overline, Txt } from "@/components/ui";
import { RichText } from "@/components/rich-text";
import { getPreparationOptions, getProduct } from "@/lib/api";
import { naira } from "@/lib/format";
import { defaultLength, netPriceForLength, priceForLength, sortedLengths } from "@/lib/product-variant";
import { useCart } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { canBeStyle } from "@/lib/face-match-api";
import { useStorefrontSettings } from "@/lib/settings";
import { signedMoney } from "@/lib/currency";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import type { PreparationOption, ProductDetail, Review } from "@/lib/types";
import { easeOut, motion, useReducedMotion } from "@/lib/motion";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, shadow } from "@/theme/tokens";

/**
 * Product detail — Figma "Refined · 2 · Product Detail" (249:102), extended.
 *
 * The frame stops at the option pickers. Everything below them — the story,
 * the specification table, delivery & returns, and reviews — is the content a
 * customer needs before spending ₦200,000 on hair, drawn in the same surface
 * language: white cards, hairlines, Fraunces for the numbers that matter.
 *
 * Three rules this screen keeps:
 *   · The verified badge never mentions an authentication video. That feature
 *     was removed from the product (CLAUDE.md).
 *   · The headline rating and count come from the API's aggregates; the
 *     review cards are the page of recent reviews it returns. The two are not
 *     mixed into an invented distribution.
 *   · Prices are display values. The server re-prices the order.
 */
const GUTTER = layout.gutter;
const MEDIA_HEIGHT = 438;
const SHEET_OVERLAP = 34;
const BUY_BAR = 88;
const REVIEWS_PREVIEW = 3;
const SPECS_PREVIEW = 5;
/** Preparation options shown inline; the rest live in the sheet. */
const PREP_PREVIEW = 2;

export default function ProductScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cart = useCart();
  // Must sit with the other hooks, ABOVE the `if (!product)` early return
  // below. It used to be called after it, so this component ran 21 hooks
  // while the piece was loading and 22 once it arrived — a Rules of Hooks
  // violation React warns about on every product page, and the kind that
  // silently misaligns state between renders.
  const { has, toggle } = useWishlist();
  const { features } = useStorefrontSettings();
  // Everything the shopper READS on this screen, the Add-to-bag total
  // included (owner decision). The one figure that stays in Naira is the
  // "Charged in ₦X" bridge line below, which names what is actually charged.
  const money = useApproxMoney();
  const { code: currency } = useCurrency();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"Wig" | "Bundle">("Wig");
  const [length, setLength] = useState<string>();
  const [colour, setColour] = useState<string>();
  const [qty, setQty] = useState(1);
  const [slide, setSlide] = useState(0);
  const [prep, setPrep] = useState<PreparationOption[]>([]);
  const [prepId, setPrepId] = useState<string>();
  const [styleValue, setStyleValue] = useState<string>();
  const [prepSheet, setPrepSheet] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [allSpecs, setAllSpecs] = useState(false);
  const [allReviews, setAllReviews] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getProduct(slug)
      .then((p) => {
        if (!alive) return;
        setProduct(p);
        // The length the admin priced as the headline, not whichever one
        // happens to be stored first — stored order is arbitrary.
        setLength(p ? defaultLength(p) : undefined);
        setColour(p?.colours[0]?.name);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setProduct(null);
        setError(e instanceof Error ? e.message : "Could not load this piece.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slug]);

  // Preparation add-ons are catalogue-wide, not per product.
  useEffect(() => {
    let alive = true;
    getPreparationOptions().then((list) => {
      if (!alive || !list?.length) return;
      setPrep(list);
      // The API flags no default, so fall back to the first — which is also
      // the cheapest "as supplied" option.
      const first = list.find((o) => o.default) ?? list[0];
      setPrepId(first.id);
      if (first.has_style) setStyleValue(first.style_options?.[0]?.value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.centre}>
        <Txt tone="strong" display size={20} center>
          We could not open this piece
        </Txt>
        <Txt tone="body" size={13} center style={{ marginTop: 8 }}>
          {error ?? "It may have sold out or been withdrawn."}
        </Txt>
        <Pressable onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Txt tone="primary" weight="medium" size={13}>
            Go back
          </Txt>
        </Pressable>
      </View>
    );
  }

  const selectedPrep = prep.find((o) => o.id === prepId);
  const selectedStyle = selectedPrep?.style_options?.find((s) => s.value === styleValue);

  /**
   * Two cards inline, the rest behind "More preparation options".
   *
   * The chosen option is ALWAYS one of the two: if it sits outside the first
   * pair it takes the second slot. Otherwise picking something from the sheet
   * would make the selection vanish from the page that shows the price.
   */
  const visiblePrep = (() => {
    const head = prep.slice(0, PREP_PREVIEW);
    if (!selectedPrep || head.some((o) => o.id === selectedPrep.id)) return head;
    return [...head.slice(0, PREP_PREVIEW - 1), selectedPrep];
  })();

  /** Selecting an option must also settle its style — the API rejects a
   *  missing one on an option that has styles. */
  const choosePrep = (option: PreparationOption) => {
    setPrepId(option.id);
    setStyleValue(option.has_style ? option.style_options?.[0]?.value : undefined);
  };
  // Per unit, like the piece itself. DISPLAY only — POST /orders re-resolves
  // the surcharge from the canonical table by key.
  const saved = has(product.id);
  // Wig detection is `category`, deliberately. `hair_category`/`hair_type` are
  // stale against their own enums in real data and match the wrong subset.
  const canTryOn =
    features.face_match_app && product.category === "wigs" && canBeStyle(product.image);
  const surcharge = (selectedPrep?.surcharge ?? 0) + (selectedStyle?.price ?? 0);
  // The selling price, matching the figure shown above it and the one the bag
  // will carry. The list price here made the Add-to-bag button quote more than
  // the bag then showed for the same piece.
  const total = (netPriceForLength(product, length) + surcharge) * qty;
  const standIn = photoFor(product.slug, product.image);
  // Real gallery when the API sends one; otherwise the single stand-in photo.
  const gallery: (string | number)[] = product.images.length
    ? product.images
    : standIn
      ? [standIn]
      : [];

  const specs = Object.entries(product.specs);
  const visibleSpecs = allSpecs ? specs : specs.slice(0, SPECS_PREVIEW);
  const reviews = product.reviews;
  const visibleReviews = allReviews ? reviews : reviews.slice(0, REVIEWS_PREVIEW);

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaces.product }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: BUY_BAR + insets.bottom + 16 }}
      >
        {/* ---- media ---- */}
        <View style={[styles.media, { width }]}>
          <LinearGradient
            colors={["#EBE0D2", "#DFD2DE"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          >
            <PdpArc width={width * 1.1} height={450} style={styles.arc} />
            <Text style={styles.monogram}>L</Text>
          </LinearGradient>

          {gallery.length ? (
            <Pressable
              onPress={() => setLightbox(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${product.name}, photo ${slide + 1} of ${gallery.length}. View full screen`}
            >
              <Image
                source={
                  typeof gallery[slide] === "string"
                    ? { uri: gallery[slide] as string }
                    : gallery[slide]
                }
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={motion.base}
                style={{ width, height: MEDIA_HEIGHT }}
              />
            </Pressable>
          ) : (
            <HairImage seed={product.slug} alt={product.name} monogramSize={120} />
          )}

          {/* Thumbnail rail, laid over the right edge of the main image — tap
              one to preview it full-size. */}
          {gallery.length > 1 ? (
            <View style={[styles.thumbs, { top: insets.top + 72 }]}>
              {gallery.map((src, i) => {
                const active = i === slide;
                return (
                  <Pressable
                    key={`thumb-${i}`}
                    onPress={() => setSlide(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show photo ${i + 1} of ${gallery.length}`}
                    style={({ pressed }) => [
                      styles.thumb,
                      active ? styles.thumbActive : styles.thumbIdle,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Image
                      source={typeof src === "string" ? { uri: src } : src}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      style={StyleSheet.absoluteFill}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={[styles.mediaBar, { top: insets.top + 8 }]}>
            <CircleButton label="Go back" onPress={() => router.back()}>
              <IconBack width={22} height={22} />
            </CircleButton>
            <View style={{ flex: 1 }} />
            <CircleButton
              label={saved ? "Remove from saved pieces" : "Save this piece"}
              onPress={() => toggle(product)}
            >
              {saved ? (
                <IconHeartOutlineFilled width={22} height={22} color={theme.colors.primary} />
              ) : (
                <IconHeartOutline width={22} height={22} color="#1A1420" />
              )}
            </CircleButton>
          </View>

          {/* No pager dots: the thumbnail rail already shows both the position
              and what is coming, and two indicators for one thing is noise. */}
        </View>

        {/* ---- purchase sheet ---- */}
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Try-on sits on the traceable-code row, high in the sheet and
              above the price — the same place the website puts it, and the
              first thing read after the photograph.

              Three conditions, and every one of them is a real constraint
              rather than a preference:
                · the owner can switch the app's studio off;
                · try-on only means anything for a WIG;
                · the server will only fetch a style image from Cloudinary,
                  so a piece photographed anywhere else would be refused
                  AFTER the customer had taken their photo and waited.
              A button that cannot finish the job should not be offered. */}
          <View style={styles.trustRow}>
            <View style={styles.verified}>
              <IconVerified width={14} height={14} color={theme.colors.primaryOn} />
              <Text style={styles.verifiedText}>Verified · unique traceable code</Text>
            </View>

            {canTryOn ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: "/try-on", params: { slug: product.slug } })
                }
                accessibilityRole="button"
                accessibilityLabel={`See ${product.name} on your own photo`}
                hitSlop={8}
                style={({ pressed }) => [styles.tryOn, pressed && { opacity: 0.75 }]}
              >
                <IconTryOn width={15} height={15} color={theme.colors.primary} />
                <Text style={styles.tryOnText}>Try on</Text>
              </Pressable>
            ) : null}
          </View>

          <Txt tone="strong" display size={24} style={{ marginTop: 16 }}>
            {product.name}
          </Txt>
          <Txt tone="body" size={11} style={{ marginTop: 8 }}>
            {product.spec}
          </Txt>

          <View style={styles.priceRow}>
            <View>
              <Txt tone="primary" display size={24}>
                {money(netPriceForLength(product, length))}
              </Txt>
              {(product.discount_percent ?? 0) > 0 ? (
                <Txt tone="faint" size={11} style={styles.compareAt}>
                  {money(priceForLength(product, length))}
                </Txt>
              ) : null}
              {/* The bridge to what is actually charged.
                  This used to sit between two figures — a converted headline
                  and an Add-to-bag button still in Naira. The button converts
                  now too (owner direction 2026-10-17), so on a non-Naira
                  setting this line is the only Naira figure on the screen,
                  which makes it more load-bearing rather than less. */}
              {currency !== "NGN" ? (
                <Txt tone="body" size={10} style={{ marginTop: 6 }}>
                  Charged in {naira(netPriceForLength(product, length))}
                </Txt>
              ) : null}

              {/* Show the add-on separately rather than folding it into the
                  headline — the piece has one price; preparation is a choice. */}
              {surcharge > 0 ? (
                <Txt tone="body" size={11} style={{ marginTop: 4 }}>
                  {signedMoney(money(surcharge), "+")} preparation
                </Txt>
              ) : null}
            </View>
            <View style={{ flex: 1 }} />
            <View style={styles.rating}>
              <Stars value={product.rating} size={11} />
              <Txt tone="strong" weight="medium" size={11}>
                {product.rating.toFixed(1)}
              </Txt>
              <Txt tone="body" size={11}>
                ({product.reviews_count})
              </Txt>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Presentational for now: the catalogue models wigs and bundles as
              separate products, so this toggle has nothing to switch between
              until the API sends variants on one product. */}
          {/* <View style={styles.segment}>
            {(["Wig", "Bundle"] as const).map((option) => {
              const active = type === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setType(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                >
                  <Text
                    style={{
                      fontFamily: fonts.medium,
                      fontSize: 11,
                      color: active ? "#FFFFFF" : theme.textInk.body,
                    }}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View> */}

          {product.lengths.length ? (
            <>
              <Txt tone="strong" weight="medium" size={12} style={styles.optionLabel}>
                Choose your length
              </Txt>
              <View style={styles.chips}>
                {sortedLengths(product.lengths).map((l) => (
                  <Chip key={l} label={l} selected={length === l} onPress={() => setLength(l)} />
                ))}
              </View>
            </>
          ) : null}

          {product.colours.length ? (
            <>
              <Txt tone="strong" weight="medium" size={12} style={styles.optionLabel}>
                Select colour
              </Txt>
              <View style={styles.chips}>
                {product.colours.map((c) => (
                  <Chip
                    key={c.name}
                    label={c.name}
                    selected={colour === c.name}
                    onPress={() => setColour(c.name)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {/* ---- preparation & styling ---- */}
          {prep.length ? (
            <>
              <Txt tone="strong" weight="medium" size={12} style={styles.optionLabel}>
                Preparation &amp; styling
              </Txt>

              <View style={{ gap: 8, marginTop: 12 }}>
                {visiblePrep.map((option) => (
                  <PrepCard
                    key={option.id}
                    option={option}
                    active={option.id === prepId}
                    styleValue={styleValue}
                    onSelect={() => choosePrep(option)}
                    onStyle={setStyleValue}
                  />
                ))}
              </View>

              {prep.length > visiblePrep.length ? (
                <Pressable
                  onPress={() => setPrepSheet(true)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.morePrep, pressed && { opacity: 0.7 }]}
                >
                  <Txt tone="primary" weight="medium" size={12}>
                    More preparation options
                  </Txt>
                  <ChevronRight width={16} height={16} />
                </Pressable>
              ) : null}

              <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
                Wigging &amp; styling add 2–3 working days.
              </Txt>
            </>
          ) : null}

          {/* ---- trust ---- */}
          <View style={styles.trust}>
            <TrustTile
              icon={<IconVerified width={16} height={16} color={theme.colors.primaryOn} />}
              title="Verified"
              sub="100% raw human hair"
            />
            <View style={styles.trustDivider} />
            <TrustTile
              icon={<IconShield width={16} height={16} />}
              title="30-day guarantee"
              sub="Quality, or your money back"
            />
            <View style={styles.trustDivider} />
            <TrustTile
              icon={<IconShipped width={18} height={18} color={theme.colors.primaryOn} />}
              title="Fast delivery"
              sub="2–4 days in Lagos"
            />
          </View>

          {/* ---- about ---- */}
          <Section overline="THE PIECE" title="About this hair">
            {/* The admin editor stores HTML, so this cannot go in a <Text> —
                that printed the tags. RichText renders the bounded tag set. */}
            <RichText html={product.description ?? ""} />
          </Section>

          {/* ---- specifications ---- */}
          {specs.length ? (
            <Section overline="SPECIFICATIONS" title="Details">
              <View style={styles.card}>
                {visibleSpecs.map(([label, value], i) => (
                  <View key={label} style={[styles.specRow, i > 0 && styles.specRowBorder]}>
                    <Txt tone="body" size={12} style={{ flex: 1 }}>
                      {label}
                    </Txt>
                    <Txt tone="strong" weight="medium" size={12} style={styles.specValue}>
                      {value}
                    </Txt>
                  </View>
                ))}
                {specs.length > SPECS_PREVIEW ? (
                  <Pressable
                    onPress={() => setAllSpecs((v) => !v)}
                    accessibilityRole="button"
                    style={styles.moreRow}
                  >
                    <Txt tone="primary" weight="medium" size={12}>
                      {allSpecs ? "Show fewer details" : `Show all ${specs.length} details`}
                    </Txt>
                    <ChevronRight
                      width={16}
                      height={16}
                      style={{ transform: [{ rotate: allSpecs ? "-90deg" : "90deg" }] }}
                    />
                  </Pressable>
                ) : null}
              </View>
            </Section>
          ) : null}

          {/* ---- delivery & returns ---- */}
          <Section overline="DELIVERY & RETURNS" title="What to expect">
            <View style={styles.card}>
              <InfoRow
                icon={<IconShipped width={18} height={18} color={theme.colors.primaryOn} />}
                title="Standard delivery"
                sub="2–4 business days within Lagos; nationwide and worldwide at checkout"
              />
              <InfoRow
                icon={<IconVerified width={16} height={16} color={theme.colors.primaryOn} />}
                title="Free in your birthday month"
                sub="Delivery is on us for the whole month, on every order"
                bordered
              />
              <InfoRow
                icon={<IconShield width={16} height={16} />}
                title="30-day quality guarantee"
                sub="Return any unit within 30 days if it is not as described"
                bordered
              />
              <InfoRow
                icon={<IconVerified width={16} height={16} color={theme.colors.primaryOn} />}
                title={`Traceable ${product.code_prefix ?? "LX"} code`}
                sub="Every unit ships with its own code and full ownership history"
                bordered
              />
            </View>
          </Section>

          {/* ---- reviews ---- */}
          <Section
            overline="REVIEWS"
            title="What customers say"
            action={
              reviews.length > REVIEWS_PREVIEW ? (
                <Pressable
                  onPress={() => setAllReviews((v) => !v)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Txt tone="primary" weight="medium" size={12}>
                    {allReviews ? "Show fewer" : "See all"}
                  </Txt>
                </Pressable>
              ) : null
            }
          >
            <View style={[styles.card, styles.summary]}>
              <View>
                <Txt tone="strong" display size={40} style={{ lineHeight: 44 }}>
                  {product.rating.toFixed(1)}
                </Txt>
                <Stars value={product.rating} size={14} />
              </View>
              <View style={{ flex: 1, marginLeft: 18 }}>
                <Txt tone="strong" weight="medium" size={13}>
                  {product.reviews_count.toLocaleString("en-NG")} review
                  {product.reviews_count === 1 ? "" : "s"}
                </Txt>
                <Txt tone="body" size={11} style={{ marginTop: 4, lineHeight: 16 }}>
                  From verified purchases. Ratings are collected after delivery, not at
                  checkout.
                </Txt>
              </View>
            </View>

            {reviews.length ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                {visibleReviews.map((r) => (
                  <ReviewCard key={`${r.author}-${r.date}`} review={r} />
                ))}
              </View>
            ) : (
              <Txt tone="body" size={12} style={{ marginTop: 12 }}>
                No written reviews yet — be the first once your order arrives.
              </Txt>
            )}
          </Section>
        </View>
      </ScrollView>

      {/* ---- purchase bar ---- */}
      {/* Solid, not frosted: expo-blur does not blur on Android, so a
          translucent bar there is just the length chips showing through. */}
      <View style={[styles.buyBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <View style={styles.qty}>
          <Pressable
            onPress={() => setQty((q) => Math.max(1, q - 1))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
          >
            <Text style={styles.qtyGlyph}>−</Text>
          </Pressable>
          <Text style={styles.qtyValue}>{qty}</Text>
          <Pressable
            onPress={() => setQty((q) => q + 1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
          >
            <Text style={styles.qtyGlyph}>+</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            cart.add(product, {
              length,
              colour,
              qty,
              preparation: selectedPrep?.id,
              // Snapshot the labels so the bag survives an admin renaming an
              // option between adding and checking out.
              preparationTitle: selectedPrep?.title,
              preparationStyle: styleValue,
              preparationStyleLabel: selectedStyle?.label,
              surcharge,
            });
            router.push("/cart");
          }}
          accessibilityRole="button"
          accessibilityLabel={`Add to bag, ${money(total)}`}
          style={({ pressed }) => [styles.addWrap, pressed && { opacity: 0.9 }]}
        >
          <LinearGradient
            colors={["#732B99", "#47126B"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.add}
          >
            <IconBagWhite width={17} height={17} />
            <Text style={styles.addText}>Add to bag  ·  {money(total)}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <PrepSheet
        open={prepSheet}
        options={prep}
        selectedId={prepId}
        styleValue={styleValue}
        onSelect={choosePrep}
        onStyle={setStyleValue}
        onClose={() => setPrepSheet(false)}
        bottomInset={insets.bottom}
      />

      <PhotoLightbox
        open={lightbox}
        photos={gallery}
        index={slide}
        name={product.name}
        onClose={(landedOn) => {
          // Carry the viewer's page back, so closing on photo 3 leaves the
          // page showing photo 3.
          setSlide(landedOn);
          setLightbox(false);
        }}
      />
    </View>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------- */

/**
 * Full-screen photo viewer.
 *
 * The product page crops its media panel to a fixed height, so hair at the
 * ends of a long piece is cut off — this is where someone actually looks at
 * the photograph. `contain` on black, so nothing is cropped and the image sets
 * its own shape.
 *
 * Paging starts on whichever photo was showing, and the page it lands on is
 * handed back on close, so the main image and the viewer never disagree.
 */
function PhotoLightbox({
  open,
  photos,
  index,
  name,
  onClose,
}: {
  open: boolean;
  photos: (string | number)[];
  index: number;
  name: string;
  onClose: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(index);
  const scroller = useRef<ScrollView>(null);
  const reduced = useReducedMotion();

  /**
   * Two animations, split by what each is good at.
   *
   * The Modal's own `fade` handles the backdrop — it is platform-native and
   * runs before JS gets a look in. The scale rides on top, and it lives in
   * `LightboxContent`, which mounts WITH the modal.
   *
   * That split matters: an entrance animation started from an effect out here
   * begins before the modal's children are attached, so the first frame the
   * platform paints is already the end state and nothing appears to move.
   * Starting it from the content's own mount is what makes it run.
   */

  // Re-open on the photo the page is showing, not wherever it was left.
  useEffect(() => {
    if (!open) return;
    setPage(index);
    // The ScrollView has to exist before it can be scrolled.
    const t = setTimeout(() => scroller.current?.scrollTo({ x: index * width, animated: false }), 0);
    return () => clearTimeout(t);
  }, [index, open, width]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => onClose(page)}
    >
      <View style={[StyleSheet.absoluteFill, styles.lightboxBackdrop, { pointerEvents: "none" }]} />

      <LightboxContent reduced={reduced} style={styles.lightbox}>
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Both handlers on purpose: a slow drag-and-release can settle
          // without ever firing momentum-end, which would leave the counter
          // (and the page handed back on close) stuck on the previous photo.
          scrollEventThrottle={16}
          onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / width))
          }
        >
          {photos.map((src, i) => (
            <View key={`full-${i}`} style={{ width, height, justifyContent: "center" }}>
              <Image
                source={typeof src === "string" ? { uri: src } : src}
                contentFit="contain"
                cachePolicy="memory-disk"
                accessibilityLabel={`${name}, photo ${i + 1} of ${photos.length}`}
                style={{ width, height: height * 0.8 }}
              />
            </View>
          ))}
        </ScrollView>

        <Pressable
          onPress={() => onClose(page)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={10}
          style={({ pressed }) => [
            styles.lightboxClose,
            { top: insets.top + 12 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.lightboxCloseGlyph}>×</Text>
        </Pressable>

        {/* A strip of the actual photos rather than "2 / 3": it says where you
            are AND what the others look like, and each one is a jump. */}
        {photos.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.lightboxStrip}
            style={[styles.lightboxStripWrap, { bottom: insets.bottom + 20 }]}
          >
            {photos.map((src, i) => {
              const active = i === page;
              return (
                <Pressable
                  key={`strip-${i}`}
                  onPress={() => {
                    setPage(i);
                    scroller.current?.scrollTo({ x: i * width, animated: true });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                  style={({ pressed }) => [
                    styles.lightboxThumb,
                    active ? styles.lightboxThumbActive : styles.lightboxThumbIdle,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Image
                    source={typeof src === "string" ? { uri: src } : src}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    style={StyleSheet.absoluteFill}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </LightboxContent>
    </Modal>
  );
}

/**
 * The lightbox's animated shell.
 *
 * Separate component on purpose: it mounts with the Modal's children, so its
 * entrance effect runs after the platform has attached them and the scale
 * actually plays. Driven from a mount effect rather than a prop, it cannot
 * race the modal's own presentation.
 */
function LightboxContent({
  reduced,
  style,
  children,
}: {
  reduced: boolean;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? 0 : motion.slow,
      easing: easeOut,
      // JS-driven: one full-screen view, and the native driver does not run
      // this reliably under the new architecture + react-native-web.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [enter, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: enter,
          // Grows the last few percent into place — enough to read as
          // "opening", not enough to feel like a bounce.
          transform: [
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * One preparation option.
 *
 * Shared by the two inline cards and the full sheet, so the row cannot drift
 * between them — and the style picker follows the selection wherever it is.
 */
function PrepCard({
  option,
  active,
  styleValue,
  onSelect,
  onStyle,
}: {
  option: PreparationOption;
  active: boolean;
  styleValue?: string;
  onSelect: () => void;
  onStyle: (value: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const money = useApproxMoney();
  const reduced = useReducedMotion();
  const reveal = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(reveal, {
      toValue: active ? 1 : 0,
      duration: reduced ? 0 : motion.fast,
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduced, reveal]);

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.prep, active ? styles.prepActive : styles.prepIdle]}
    >
      <View style={styles.prepHead}>
        <View style={[styles.radio, active && styles.radioOn]}>
          {active ? <View style={styles.radioDot} /> : null}
        </View>

        <View style={{ flex: 1, marginLeft: 10 }}>
          <Txt tone="strong" weight="medium" size={12}>
            {option.title}
          </Txt>
          {option.caption ? (
            <Txt tone="body" size={10} style={{ marginTop: 3, lineHeight: 14 }}>
              {option.caption}
            </Txt>
          ) : null}
        </View>

        <Txt tone={option.surcharge ? "strong" : "success"} weight="medium" size={11}>
          {option.surcharge ? signedMoney(money(option.surcharge), "+") : "Included"}
        </Txt>
      </View>

      {/* The style picker belongs to the chosen option only. It eases in
          rather than popping — the card changes height, and an unannounced
          jump under the finger reads as a glitch. */}
      {active && option.has_style && option.style_options?.length ? (
        <Animated.View
          style={[
            styles.styleRow,
            { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] },
          ]}
        >
          {option.style_options.map((s) => (
            <Chip
              key={s.value}
              label={s.price ? `${s.label}  ${signedMoney(money(s.price), "+")}` : s.label}
              selected={styleValue === s.value}
              onPress={() => onStyle(s.value)}
            />
          ))}
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/** The full preparation list, for when two inline cards are not enough. */
function PrepSheet({
  open,
  options,
  selectedId,
  styleValue,
  onSelect,
  onStyle,
  onClose,
  bottomInset,
}: {
  open: boolean;
  options: PreparationOption[];
  selectedId?: string;
  styleValue?: string;
  onSelect: (option: PreparationOption) => void;
  onStyle: (value: string) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel="Close preparation options"
      />

      <View style={[styles.sheetModal, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
        <View style={styles.sheetHandle} />

        <Txt tone="strong" display size={20} style={{ marginTop: 14 }}>
          Preparation &amp; styling
        </Txt>
        <Txt tone="body" size={11} style={{ marginTop: 6, lineHeight: 16 }}>
          How the hair is prepared before it ships. Wigging &amp; styling add 2–3 working days.
        </Txt>

        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 8, marginTop: 14 }}>
            {options.map((option) => (
              <PrepCard
                key={option.id}
                option={option}
                active={option.id === selectedId}
                styleValue={styleValue}
                onSelect={() => onSelect(option)}
                onStyle={onStyle}
              />
            ))}
          </View>
        </ScrollView>

        <GradientButton label="Done" height={52} style={{ marginTop: 16 }} onPress={onClose} />
      </View>
    </Modal>
  );
}

function Section({
  overline,
  title,
  action,
  children,
}: {
  overline: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: 28 }}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Overline>{overline}</Overline>
          <Txt tone="strong" display size={18} style={{ marginTop: 6 }}>
            {title}
          </Txt>
        </View>
        {action}
      </View>
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

/** Gold stars on a five-point scale; half-fills round to the nearest half. */
function Stars({ value, size }: { value: number; size: number }) {
  const theme = useTheme();
  const rounded = Math.round(value * 2) / 2;
  return (
    <View style={{ flexDirection: "row", gap: 1 }} accessibilityLabel={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const full = i <= Math.floor(rounded);
        const half = !full && i - 0.5 === rounded;
        return (
          <Text
            key={i}
            style={{
              fontSize: size,
              lineHeight: size + 3,
              color: full || half ? theme.colors.gold2 : theme.surfaces.handle,
              includeFontPadding: false,
            }}
          >
            {half ? "⯪" : "★"}
          </Text>
        );
      })}
    </View>
  );
}

function TrustTile({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.trustTile}>
      <View style={styles.trustIcon}>{icon}</View>
      <Txt tone="strong" weight="medium" size={10} center style={{ marginTop: 8 }}>
        {title}
      </Txt>
      <Txt tone="body" size={9} center style={{ marginTop: 2, lineHeight: 13 }}>
        {sub}
      </Txt>
    </View>
  );
}

function InfoRow({
  icon,
  title,
  sub,
  bordered,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  bordered?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.infoRow, bordered && styles.specRowBorder]}>
      <View style={styles.infoIcon}>{icon}</View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Txt tone="strong" weight="medium" size={12}>
          {title}
        </Txt>
        <Txt tone="body" size={11} style={{ marginTop: 3, lineHeight: 16 }}>
          {sub}
        </Txt>
      </View>
    </View>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={styles.reviewHead}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{review.author.trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Txt tone="strong" weight="medium" size={12}>
              {review.author}
            </Txt>
            {review.verified ? (
              <View style={styles.verifiedMini}>
                <IconVerified width={10} height={10} color={theme.colors.primaryOn} />
                <Text style={styles.verifiedMiniText}>Verified</Text>
              </View>
            ) : null}
          </View>
          <Txt tone="body" size={10} style={{ marginTop: 2 }}>
            {review.location} · {formatDate(review.date)}
          </Txt>
        </View>
        <Stars value={review.rating} size={11} />
      </View>

      <Txt tone="body" size={12} style={{ marginTop: 10, lineHeight: 19 }}>
        {review.body}
      </Txt>

      {review.variant ? (
        <View style={styles.variant}>
          <Txt tone="body" size={10}>
            Bought {review.variant}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Jun 2026" — tolerant of the API's date-only and datetime forms. */
function formatDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------------------------------------------------------------------------
 * Styles
 * ------------------------------------------------------------------------- */

const makeStyles = (t: Theme) => StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: t.surfaces.product,
  },

  media: { height: MEDIA_HEIGHT, overflow: "hidden" },
  arc: { position: "absolute", left: -44, top: -125 },
  monogram: {
    position: "absolute",
    alignSelf: "center",
    top: 120,
    fontFamily: fonts.display,
    fontSize: 167,
    color: "rgba(255,255,255,0.15)",
  },
  mediaBar: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    flexDirection: "row",
    alignItems: "center",
  },
  dots: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: { height: 6, borderRadius: 3 },

  sheet: {
    marginTop: -SHEET_OVERLAP,
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: GUTTER,
    paddingTop: 12,
    paddingBottom: 32,
    // Kept on iOS, where the shadow can be aimed upward at the media. Android
    // elevation is a halo on every side — at 12 it painted a grey band BELOW
    // the sheet, over the page — and the photo/white edge separates fine on
    // its own, so there it is off.
    ...shadow({ color: "#1A0D21", opacity: 0.14, radius: 24, offsetY: -8, elevation: 0 }),
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
  },
  trustRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  verified: {
    flexShrink: 1,
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: t.surfaces.verifiedTint,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  verifiedText: { fontFamily: fonts.medium, fontSize: 9, color: t.colors.primaryOn },
  /** Outlined, not filled: Add to bag is the page's one solid action. */
  tryOn: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.colors.primaryOn,
  },
  tryOnText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  // Thumbnail rail over the main image's right edge.
  thumbs: { position: "absolute", right: 12, gap: 8 },
  thumb: {
    width: 54,
    height: 68,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  thumbActive: { borderColor: "#FFFFFF" },
  thumbIdle: { borderColor: "rgba(255,255,255,0.45)", opacity: 0.75 },

  // Preparation & styling radio cards.
  prep: { borderRadius: 16, borderWidth: 1, padding: 14 },
  prepIdle: { backgroundColor: t.colors.surface, borderColor: t.surfaces.lineProduct },
  prepActive: { backgroundColor: t.surfaces.actionTint, borderColor: t.colors.primaryOn },
  prepHead: { flexDirection: "row", alignItems: "center" },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: t.surfaces.lineProduct,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: t.colors.primaryOn },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary },
  styleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    marginLeft: 30,
  },
  morePrep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 12,
    paddingVertical: 4,
  },

  // Full-screen photo viewer. Near-black rather than pure black so the frame
  // still reads as a surface against a dark product photo.
  lightboxBackdrop: { backgroundColor: "#0B060E" },
  lightbox: { flex: 1 },
  lightboxClose: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxCloseGlyph: {
    fontFamily: fonts.body,
    fontSize: 26,
    lineHeight: 30,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  // Absolute, so the strip floats over the photo instead of shrinking it.
  lightboxStripWrap: { position: "absolute", left: 0, right: 0, maxHeight: 76 },
  // flexGrow + centre: sits centred while the thumbnails fit, and scrolls
  // from the left once a product has enough photos to overflow.
  lightboxStrip: {
    gap: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
  },
  lightboxThumb: {
    width: 52,
    height: 66,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  lightboxThumbActive: { borderColor: "#FFFFFF" },
  lightboxThumbIdle: { borderColor: "transparent", opacity: 0.55 },

  // The preparation sheet, in the same language as the shop's filter sheet.
  scrim: { flex: 1, backgroundColor: "rgba(20,12,26,0.34)" },
  sheetModal: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
  },

  priceRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  compareAt: { textDecorationLine: "line-through", marginTop: 2 },
  rating: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  divider: { height: 1, backgroundColor: t.surfaces.lineProduct, marginTop: 20 },

  segment: {
    marginTop: 16,
    height: 46,
    borderRadius: 16,
    backgroundColor: t.surfaces.segmentTrack,
    flexDirection: "row",
    padding: 4,
  },
  segmentItem: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  segmentItemActive: { backgroundColor: t.colors.primary },

  optionLabel: { marginTop: 24 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },

  trust: {
    marginTop: 24,
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    backgroundColor: t.colors.surface,
    paddingVertical: 14,
  },
  trustTile: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  trustDivider: { width: 1, backgroundColor: t.surfaces.lineProduct, marginVertical: 4 },
  trustIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.surfaces.verifiedTint,
    alignItems: "center",
    justifyContent: "center",
  },

  sectionHead: { flexDirection: "row", alignItems: "flex-end" },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    backgroundColor: t.colors.surface,
    paddingHorizontal: 14,
  },
  specRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, gap: 16 },
  specRowBorder: { borderTopWidth: 1, borderTopColor: t.surfaces.line },
  specValue: { flex: 1.3, textAlign: "right" },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.line,
  },

  infoRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12 },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.surfaces.verifiedTint,
    alignItems: "center",
    justifyContent: "center",
  },

  summary: { flexDirection: "row", alignItems: "center", paddingVertical: 16 },
  reviewHead: { flexDirection: "row", alignItems: "center", paddingTop: 14 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.display, fontSize: 15, color: t.colors.primaryOn },
  verifiedMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    backgroundColor: t.surfaces.verifiedTint,
  },
  verifiedMiniText: { fontFamily: fonts.medium, fontSize: 9, color: t.colors.primaryOn },
  variant: {
    alignSelf: "flex-start",
    marginTop: 10,
    marginBottom: 14,
    height: 22,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: t.surfaces.stepperTrack,
    justifyContent: "center",
  },

  buyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    backgroundColor: t.glassNav.surface,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.line,
    // Android draws elevation as a halo on every side, so anything above ~3
    // paints a grey band over the content ABOVE the bar. The hairline does
    // most of the separating; the shadow is a whisper.
    ...shadow({ color: "#1A0F21", opacity: 0.05, radius: 10, offsetY: -2, elevation: 3 }),
  },
  qty: {
    width: 96,
    height: 54,
    borderRadius: 18,
    backgroundColor: t.surfaces.actionTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
  },
  qtyGlyph: { fontFamily: fonts.body, fontSize: 18, color: t.colors.primaryOn },
  qtyValue: { fontFamily: fonts.medium, fontSize: 13, color: t.colors.primaryOn },
  addWrap: { flex: 1, height: 54, borderRadius: 27, overflow: "hidden" },
  add: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  addText: { fontFamily: fonts.medium, fontSize: 12, color: "#FFFFFF" },
});
