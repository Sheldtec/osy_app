import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { AccountShell, Empty, Loading, Panel, Thumb } from "@/components/account-ui";
import { Txt } from "@/components/ui";
import { useApproxMoney } from "@/lib/currency-context";
import { useWishlist, type WishItem } from "@/lib/wishlist";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/theme-context";

/**
 * Saved pieces.
 *
 * Kept on this device rather than on the account, because there is no wishlist
 * endpoint — on the website it is browser storage too. The screen says so
 * rather than letting someone assume it follows them to a new phone.
 */
export default function WishlistScreen() {
  const { items, ready, remove, clear } = useWishlist();

  return (
    <AccountShell
      title="Saved pieces"
      subtitle={
        items.length
          ? `${items.length} saved on this device`
          : undefined
      }
    >
      {!ready ? <Loading label="Opening your saved pieces…" /> : null}

      {ready && items.length === 0 ? (
        <Empty
          title="Nothing saved yet"
          body="Tap the heart on any piece to keep it here while you decide."
          action={{ label: "Browse the collection", onPress: () => router.replace("/shop") }}
        />
      ) : null}

      {ready && items.length > 0 ? (
        <>
          {items.map((item) => (
            <SavedRow key={item.id} item={item} onRemove={() => remove(item.id)} />
          ))}

          <View style={{ marginTop: 20 }}>
            <Txt tone="body" size={9} center style={{ lineHeight: 14 }}>
              Saved pieces are kept on this device only, so they won’t follow you to another
              phone. Prices are what the piece cost when you saved it.
            </Txt>
            <Pressable
              onPress={clear}
              accessibilityRole="button"
              accessibilityLabel="Remove all saved pieces"
              style={({ pressed }) => [{ alignItems: "center", paddingVertical: 16 }, pressed && { opacity: 0.7 }]}
            >
              <Txt tone="danger" size={11} weight="medium">
                Clear all
              </Txt>
            </Pressable>
          </View>
        </>
      ) : null}
    </AccountShell>
  );
}

function SavedRow({ item, onRemove }: { item: WishItem; onRemove: () => void }) {
  const theme = useTheme();
  // The price as saved — a record, not a charge.
  const money = useApproxMoney();
  return (
    <Panel>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable
          onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: item.slug } })}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.name}`}
          style={({ pressed }) => pressed && { opacity: 0.8 }}
        >
          <Thumb src={item.image} seed={item.slug} alt={item.name} width={68} height={78} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 16 }}>
            {item.name}
          </Txt>
          {item.spec ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }} numberOfLines={1}>
              {item.spec}
            </Txt>
          ) : null}
          <Txt tone="primary" display size={17} style={{ marginTop: 8 }}>
            {money(item.price)}
          </Txt>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pressable
              onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: item.slug } })}
              accessibilityRole="button"
              accessibilityLabel={`Choose options for ${item.name}`}
              style={({ pressed }) => [chooseBtn(theme), pressed && { opacity: 0.75 }]}
            >
              <Txt tone="primary" size={10} weight="medium">
                Choose options
              </Txt>
            </Pressable>

            <Pressable
              onPress={onRemove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name} from saved pieces`}
              hitSlop={8}
              style={({ pressed }) => [removeBtn(theme), pressed && { opacity: 0.75 }]}
            >
              <Txt tone="body" size={10}>
                Remove
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Panel>
  );
}

/**
 * Deliberately NOT a one-tap "add to bag".
 *
 * Length, colour and preparation are all priced, and the server refuses a
 * length it does not sell — so adding a saved piece blind would either guess
 * the variant or 422 at checkout. The product page is where those are chosen.
 */
const chooseBtn = (t: Theme) => ({
  height: 34,
  paddingHorizontal: 14,
  borderRadius: 17,
  borderWidth: 1,
  borderColor: t.colors.primaryOn,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});

const removeBtn = (t: Theme) => ({
  height: 34,
  paddingHorizontal: 12,
  borderRadius: 17,
  borderWidth: 1,
  borderColor: t.surfaces.line,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});
