import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HairImage } from "@/components/hair-image";
import { DeliveryIconBg, EmptyBag, IconDelivery, IconRemove, IconTag, photoFor } from "@/components/icons";
import { Badge, Card, GradientButton, Stepper, Txt } from "@/components/ui";
import { signedMoney } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import { netPriceForLength } from "@/lib/product-variant";
import { lineKey, useCart } from "@/lib/cart";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, shadow } from "@/theme/tokens";

/**
 * Cart — Figma "Refined · 18 · Cart" (319:2).
 *
 * One deliberate departure from the mockup: the frame shows a "LUXE15
 * discount −€15" line in the summary. A discount is money, and this client
 * cannot invent one — the promo code is captured and carried to checkout for
 * the SERVER to validate and price. The discount row therefore appears only
 * when a real discount comes back, which today it never does.
 */
const GUTTER = layout.gutter;

export default function CartScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { lines, subtotal, count, ready, setQty, remove, clear } = useCart();
  const [promo, setPromo] = useState("");
  const money = useApproxMoney();

  // Delivery is NOT free and is not known here. The server prices it from the
  // admin's shipping zones once it knows the destination state, and the
  // fallback for an unmatched location is ₦31,000 — so a hard-coded 0 here
  // understated the real total by more than the delivery itself. The bag shows
  // the subtotal and says where the rest is settled.
  const total = subtotal;

  return (
    <View style={{ flex: 1, backgroundColor: theme.surfaces.cart }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          // No NAV_CLEARANCE: the floating bar is hidden on this screen, so
          // reserving room for it would leave a dead strip under the last line.
          // 110 is the checkout bar's own height plus its gap.
          paddingBottom: insets.bottom + 110,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Txt tone="strong" display size={28}>
              Your cart
            </Txt>
            <Txt tone="soft" size={12} style={{ marginTop: 8 }}>
              {count === 0
                ? "Nothing here yet"
                : `${count} item${count === 1 ? "" : "s"} · Ready when you are`}
            </Txt>
          </View>

          {count > 0 ? (
            <Pressable
              onPress={clear}
              accessibilityRole="button"
              style={({ pressed }) => [styles.clear, pressed && { opacity: 0.7 }]}
            >
              <Txt tone="primary" weight="medium" size={12}>
                Clear
              </Txt>
            </Pressable>
          ) : null}
        </View>

        {!ready ? null : lines.length === 0 ? (
          /*
           * The empty bag.
           *
           * It used to be two lines of left-aligned text in a card at the top
           * of an otherwise blank screen, which read like a form validation
           * message rather than a shop. An empty state is still a page: it gets
           * the screen's full attention, centred, with one clear way forward.
           *
           * The illustration is line-drawn in the hairline colour rather than
           * filled — it is scenery, not a control, and a heavy graphic here
           * would compete with the button that actually matters. It carries no
           * accent mark either: a sparkle reads as "AI" in this app, where the
           * four-point star belongs to the try-on studio, so one sitting on a
           * shopping bag promised something this screen does not do.
           */
          <View style={styles.empty}>
            <EmptyBag width={104} height={104} color={theme.surfaces.lineProduct} />

            {/* `tone` is explicit: Txt defaults to the BODY grey, so a display
                heading without it renders muted and reads as disabled. */}
            <Txt tone="strong" display size={21} center style={{ marginTop: 26 }}>
              Your bag is empty
            </Txt>
            <Txt tone="body" size={12.5} center style={{ marginTop: 8, lineHeight: 19 }}>
              Pieces you add will wait here — with the length, colour and
              preparation you chose, ready when you are.
            </Txt>

            <GradientButton
              label="Start shopping"
              height={50}
              style={{ marginTop: 28, alignSelf: "stretch" }}
              onPress={() => router.push("/shop")}
            />

            {/* The quieter second door. Somebody with an empty bag has often
                already saved something; sending them only to the full
                catalogue ignores the shortlist they built. */}
            <Pressable
              onPress={() => router.push("/account/wishlist")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.emptyLink, pressed && { opacity: 0.7 }]}
            >
              <Txt tone="primary" weight="medium" size={12.5}>
                View your saved pieces
              </Txt>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 12, paddingHorizontal: GUTTER }}>
            {lines.map((line) => {
              const key = lineKey(line);
              const variant = [line.length, line.colour].filter(Boolean).join(" · ");

              return (
                <View key={key} style={styles.item}>
                  <View style={styles.itemImage}>
                    <HairImage
                      src={photoFor(line.product.slug, line.product.image)}
                      seed={line.product.slug}
                      alt={line.product.name}
                      monogramSize={40}
                    />
                  </View>

                  <View style={styles.itemBody}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Txt tone="strong" weight="medium" size={15} style={{ flex: 1 }} numberOfLines={1}>
                        {line.product.name}
                      </Txt>
                      <Pressable
                        onPress={() => remove(key)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${line.product.name}`}
                      >
                        <IconRemove width={18} height={18} color={theme.textInk.faint} />
                      </Pressable>
                    </View>

                    <Txt tone="body" size={11} style={{ marginTop: 6 }}>
                      {variant || line.product.spec}
                    </Txt>

                    {/* The preparation is part of what was bought and part of
                        what is charged, so the line has to name it. */}
                    {line.preparationTitle ? (
                      <Txt tone="body" size={10} style={{ marginTop: 4 }}>
                        {line.preparationTitle}
                        {line.preparationStyleLabel ? ` · ${line.preparationStyleLabel}` : ""}
                        {line.surcharge ? ` · ${signedMoney(money(line.surcharge), "+")}` : ""}
                      </Txt>
                    ) : null}

                    <Badge label="IN STOCK" style={{ marginTop: 8 }} />

                    <View style={styles.itemFooter}>
                      <Txt tone="strong" display size={16}>
                        {money((netPriceForLength(line.product, line.length) + (line.surcharge ?? 0)) * line.qty)}
                      </Txt>
                      <View style={{ flex: 1 }} />
                      <Stepper compact qty={line.qty} onChange={(q) => setQty(key, q)} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {lines.length > 0 ? (
          <>
            <Card style={[styles.block, styles.delivery]} padded={false}>
              <View style={styles.deliveryIcon}>
                <IconDelivery width={22} height={22} color={theme.colors.primaryOn} />
              </View>

              <View style={{ flex: 1 }}>
                <Txt tone="strong" weight="medium" size={13}>
                  Delivery
                </Txt>
                <Txt tone="body" size={10} style={{ marginTop: 4 }}>
                  Calculated at checkout, once we know where it’s going
                </Txt>
              </View>
            </Card>

            <Card style={[styles.block, styles.promo]} padded={false}>
              <IconTag width={20} height={20} color={theme.colors.primaryOn} />
              <TextInput
                value={promo}
                onChangeText={setPromo}
                placeholder="Add promo code"
                placeholderTextColor={theme.textInk.body}
                autoCapitalize="characters"
                accessibilityLabel="Promo code"
                style={styles.promoInput}
              />
              {/* Codes are evaluated by the server against the priced cart, so
                  there is nothing to apply here. The value rides to checkout,
                  where it is previewed and then redeemed with the order. The
                  button used to have no handler at all and did nothing. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use this code at checkout"
                onPress={() => router.push({ pathname: "/checkout", params: promo.trim() ? { promo: promo.trim() } : {} })}
                disabled={!promo.trim()}
                style={({ pressed }) => [
                  styles.apply,
                  !promo.trim() && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt tone="primary" weight="medium" size={11}>
                  Use
                </Txt>
              </Pressable>
            </Card>

            <Card style={styles.block}>
              <Txt tone="strong" weight="medium" size={15}>
                Order summary
              </Txt>

              <SummaryRow label="Subtotal" value={money(subtotal)} />
              <SummaryRow label="Delivery" value="At checkout" />

              <View style={styles.divider} />

              <View style={styles.totalRow}>
                <Txt tone="strong" weight="medium" size={13}>
                  Total
                </Txt>
                <Txt tone="strong" display size={20}>
                  {money(total)}
                </Txt>
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>

      {lines.length > 0 ? (
        <View style={[styles.checkoutBar, { bottom: insets.bottom + 12 }]}>
          <View>
            <Txt tone="body" size={9} style={{ letterSpacing: 1 }}>
              TOTAL
            </Txt>
            <Txt tone="strong" display size={20} style={{ marginTop: 2 }}>
              {money(total)}
            </Txt>
          </View>

          <GradientButton
            label="Secure checkout   →"
            height={56}
            style={{ flex: 1, marginLeft: 18 }}
            onPress={() =>
              router.push({ pathname: "/checkout", params: promo ? { promo } : {} })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryRow}>
      <Txt tone="body" size={11}>
        {label}
      </Txt>
      <Txt tone="strong" weight="medium" size={11}>
        {value}
      </Txt>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: GUTTER,
    marginBottom: 20,
  },
  clear: {
    height: 34,
    paddingHorizontal: 18,
    borderRadius: 17,
    backgroundColor: t.surfaces.actionTint,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    alignItems: "center",
    justifyContent: "center",
  },

  item: {
    flexDirection: "row",
    gap: 14,
    padding: 12,
    borderRadius: 20,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.line,
  },
  itemImage: { width: 104, height: 118, borderRadius: 15, overflow: "hidden" },
  itemBody: { flex: 1, minHeight: 118 },
  itemFooter: { flexDirection: "row", alignItems: "center", marginTop: "auto" },

  block: { marginHorizontal: GUTTER, marginTop: 16 },
  empty: {
    alignItems: "center",
    paddingHorizontal: GUTTER + 12,
    // Not vertically centred in the viewport: an empty state that floats in
    // the middle of a tall screen reads as an error. Sitting a little above
    // centre keeps it in the thumb's reach and under the title.
    paddingTop: 48,
  },
  emptyLink: { marginTop: 18, paddingVertical: 8 },
  delivery: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 13,
    borderRadius: 18,
  },
  deliveryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },

  promo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 16,
  },
  promoInput: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: t.colors.ink },
  apply: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
  },
  divider: { height: 1, backgroundColor: t.surfaces.lineSoft, marginTop: 16 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
  },

  checkoutBar: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    height: 88,
    borderRadius: 24,
    borderWidth: 1,
    // Solid, not frosted: expo-blur does not blur on Android, so a translucent
    // bar there is just content showing through. Same surface as the nav.
    borderColor: t.surfaces.line,
    backgroundColor: t.glassNav.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 17,
    ...shadow({ color: "#1A0F21", opacity: 0.1, radius: 20, offsetY: 8, elevation: 6 }),
  },
});
