import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Divide, Line, SectionLabel, Thumb } from "@/components/account-ui";
import { GradientButton, Txt } from "@/components/ui";
import { getProduct } from "@/lib/api";
import { signedMoney } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import type { OrderItem } from "@/lib/account-api";
import type { ProductDetail } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * One piece from an order, opened from its row.
 *
 * Built around the ORDER LINE, not the product. An order item snapshots its
 * own name, slug and prices and its `product_id` is nullOnDelete, so the piece
 * can outlive the product it was bought from — a sheet that waited on a fetch
 * would show nothing at all for exactly the old orders people dig up. So
 * everything the customer paid for renders immediately from the line, and the
 * live product is a bonus layered on when it still exists.
 */
export function OrderPieceSheet({
  item,
  open,
  onClose,
  bottomInset,
}: {
  item: OrderItem | null;
  open: boolean;
  onClose: () => void;
  bottomInset: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const money = useApproxMoney();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [looking, setLooking] = useState(false);
  /** The product is gone, archived, or unreachable — not an error to shout about. */
  const [missing, setMissing] = useState(false);

  const slug = item?.slug ?? null;

  useEffect(() => {
    if (!open || !slug) return;

    let cancelled = false;
    setProduct(null);
    setMissing(false);
    setLooking(true);

    getProduct(slug)
      .then((p) => {
        if (cancelled) return;
        setProduct(p);
        setMissing(p === null);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      })
      .finally(() => {
        if (!cancelled) setLooking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  if (!item) return null;

  const variant = [item.length, item.colour, item.density].filter(Boolean).join(" · ");
  const prep = [item.preparation, item.preparation_style].filter(Boolean).join(" · ");
  const specs = Object.entries(product?.specs ?? {}).slice(0, 6);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close piece details" />

      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
        <View style={styles.handle} />

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          {/* ---- what it is ---- */}
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Thumb src={item.image} seed={item.slug ?? String(item.id)} alt={item.name} width={72} height={84} />
            <View style={{ flex: 1 }}>
              <Txt tone="strong" display size={17} style={{ lineHeight: 23 }}>
                {item.name}
              </Txt>
              {variant ? (
                <Txt tone="body" size={10} style={{ marginTop: 6 }}>
                  {variant}
                </Txt>
              ) : null}
              {product?.spec ? (
                <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                  {product.spec}
                </Txt>
              ) : null}
            </View>
          </View>

          {/* ---- the unit's own code ---- */}
          {item.codes.length ? (
            <View style={{ marginTop: 16 }}>
              <SectionLabel style={{ marginTop: 0 }}>
                {item.codes.length === 1 ? "UNIT CODE" : "UNIT CODES"}
              </SectionLabel>
              <View style={{ marginTop: 8, gap: 5 }}>
                {item.codes.map((c) => (
                  <Txt key={c} tone="strong" size={12} weight="medium" selectable style={{ letterSpacing: 0.8 }}>
                    {c}
                  </Txt>
                ))}
              </View>
            </View>
          ) : null}

          {/* ---- what was paid ---- */}
          <SectionLabel style={{ marginTop: 20 }}>WHAT YOU PAID</SectionLabel>
          <View style={{ marginTop: 10 }}>
            <Line label="Unit price" value={money(item.unit_price)} />
            {item.surcharge > 0 ? (
              <Line label={prep || "Preparation"} value={signedMoney(money(item.surcharge), "+")} />
            ) : prep ? (
              <Line label="Preparation" value={prep} />
            ) : null}
            <Line label="Quantity" value={String(item.qty)} />
            <Divide />
            <Line label="Line total" value={money(item.line_total)} strong />
          </View>

          {/* ---- the live product, when it is still there ---- */}
          {specs.length ? (
            <>
              <SectionLabel style={{ marginTop: 20 }}>ABOUT THIS PIECE</SectionLabel>
              <View style={{ marginTop: 10 }}>
                {specs.map(([k, v]) => (
                  <Line key={k} label={k} value={String(v)} />
                ))}
              </View>
            </>
          ) : null}

          {product?.description ? (
            <Txt tone="body" size={10} style={{ marginTop: 14, lineHeight: 16 }}>
              {product.description}
            </Txt>
          ) : null}

          {looking ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Txt tone="body" size={9}>
                Looking up this piece…
              </Txt>
            </View>
          ) : null}

          {/* A piece that is no longer sold is a normal thing for an old
              order, so it is stated plainly rather than as a failure. */}
          {missing && !looking ? (
            <Txt tone="body" size={9} style={{ marginTop: 16, lineHeight: 14 }}>
              We don’t carry this piece any more, so there’s no page to open — but everything you
              ordered is above.
            </Txt>
          ) : null}
        </ScrollView>

        {product && !missing ? (
          <GradientButton
            label="View this piece"
            style={{ marginTop: 16 }}
            onPress={() => {
              onClose();
              router.push({ pathname: "/product/[slug]", params: { slug: product.slug } });
            }}
          />
        ) : null}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [{ alignItems: "center", paddingVertical: 14 }, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
    </Modal>
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
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
    marginBottom: 16,
  },
  close: { fontFamily: fonts.medium, fontSize: 11, color: t.textInk.body },
});

