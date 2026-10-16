import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ComponentProps } from "react";
import { Tabs } from "expo-router";

/**
 * Derived from expo-router's own `Tabs`, not imported from
 * @react-navigation/bottom-tabs.
 *
 * expo-router 7 vendors its own copy of the navigation types, and they are NOT
 * structurally identical to the ones @react-navigation/bottom-tabs ships — the
 * header option types differ down to `tintColor: ColorValue` vs `string`, so
 * taking the type from the other package makes this component reject the very
 * props expo-router passes it. Deriving from the public component keeps the two
 * in step through future upgrades without deep-importing build internals.
 */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

import { NavCart, NavCartDot, NavCommunity, NavHome, NavProfile, NavShop } from "@/components/icons";
import { useCart } from "@/lib/cart";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout, shadow } from "@/theme/tokens";

/**
 * The floating pill navigation.
 *
 * Owner direction 2026-09-03, superseding the frame ("Navigation/Glass
 * Floating") on two points:
 *
 *   1. SOLID, not frosted. expo-blur does not blur on Android — it falls back
 *      to a plain translucent view — so the frame's glass bar was a
 *      see-through wash with product cards bleeding through it on the
 *      owner's phone, and looked different on every screen because every
 *      screen has a different background. A near-opaque white surface with a
 *      hairline and a soft lift reads identically everywhere.
 *
 *   2. SYMMETRIC tabs. The frame widens the active tab into a row-layout pill,
 *      which shoves the other four sideways on every switch. Five equal
 *      columns, icon over label; the active one is tinted, not resized.
 *
 * It floats above the home indicator rather than sitting on it, so the inset
 * comes from the safe area rather than a magic number.
 */

/**
 * The bar's tabs, in order.
 *
 * WALLET is deliberately absent now (owner direction 2026-10-16, replacing it
 * with Account and superseding the 2026-10-13 direction that put Wallet here).
 * It is still a route and still navigable — a route not listed here simply
 * renders nothing in the bar — and it is one tap away from the Wallet tile at
 * the top of Account.
 *
 * Account earns the slot because everything a returning customer comes back
 * for lives behind it: orders, saved pieces, pre-orders, notifications and the
 * wallet itself.
 */
const TABS = {
  index: { label: "Home", Icon: NavHome },
  shop: { label: "Shop", Icon: NavShop },
  cart: { label: "Cart", Icon: NavCart },
  community: { label: "Community", Icon: NavCommunity },
  profile: { label: "Account", Icon: NavProfile },
} as const;

type TabName = keyof typeof TABS;

const BAR_HEIGHT = 64;

/**
 * Tabs that take the whole screen, with no bar over them.
 *
 * Community is a conversation: the composer belongs at the bottom edge, and a
 * floating bar above it would both crowd the keyboard and cover the newest
 * message — the one thing a chat must never hide. Those screens carry their own
 * back control instead, so hiding the bar never strands anyone.
 */
const IMMERSIVE: readonly string[] = ["community"];

export function GlassNav({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { count } = useCart();

  if (IMMERSIVE.includes(state.routes[state.index]?.name ?? "")) return null;

  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12), pointerEvents: "box-none" }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name as TabName];
          if (!tab) return null;

          const focused = state.index === index;
          const { Icon, label } = tab;
          const showDot = route.name === "cart" && count > 0;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={
                showDot ? `${label}, ${count} item${count === 1 ? "" : "s"}` : label
              }
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={({ pressed }) => [styles.tab, pressed && !focused && { opacity: 0.6 }]}
            >
              <View style={styles.well}>
                <Icon width={22} height={22} color={focused ? theme.colors.primaryOn : theme.textInk.nav} />
                {showDot ? <NavCartDot width={7} height={7} style={styles.dot} /> : null}
              </View>

              <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** How much room screens must leave at the bottom so the bar never covers content. */
export const NAV_CLEARANCE = BAR_HEIGHT + 20;

const makeStyles = (t: Theme) => StyleSheet.create({
  wrap: { position: "absolute", left: layout.gutter, right: layout.gutter },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    backgroundColor: t.glassNav.surface,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    // The one shadow that earns its keep: the bar floats over scrolling
    // content and needs to separate from it.
    ...shadow({ color: "#1A0F21", opacity: 0.12, radius: 22, offsetY: 8, elevation: 6 }),
  },
  tab: { flex: 1, height: BAR_HEIGHT, alignItems: "center", justifyContent: "center", gap: 3 },
  well: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * No fill behind the icon, in either state.
   *
   * Owner direction: the active tab is signalled by COLOUR — the icon and its
   * label turn brand purple — not by a shape appearing behind the glyph. The
   * well stays only as a fixed-size box so the icons sit on one baseline
   * whatever their individual artwork does.
   */
  label: { fontFamily: fonts.body, fontSize: 10.5, color: t.textInk.nav, includeFontPadding: false },
  labelActive: { fontFamily: fonts.medium, color: t.colors.primaryOn },
  dot: { position: "absolute", right: 8, top: 1 },
});
