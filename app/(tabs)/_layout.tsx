import { Tabs } from "expo-router";

import { ConciergeFab } from "@/components/concierge-fab";
import { ScrollRevealProvider } from "@/lib/scroll-reveal";
import { GlassNav } from "@/components/glass-nav";

/**
 * Five tabs behind the floating glass bar: Home · Shop · Cart · Community ·
 * Account. (Owner direction 2026-10-16, which puts Account in the slot Wallet
 * held since 2026-10-13.)
 *
 * WALLET keeps its route but is NOT in the bar — it is reached from the Wallet
 * tile at the top of Account, one tap away. `href: null` is what removes it
 * from the bar while leaving `/wallet` navigable; deleting the Tabs.Screen
 * entry would not, because every file in this folder becomes a tab.
 *
 * `tabBar` is fully custom because the bar floats over the content rather than
 * docking to the bottom edge — a default tab bar cannot do that.
 *
 * It is also HIDDEN on Cart (owner decision 2026-10-15). That screen ends in a
 * total and a "Secure checkout" button, and a floating bar above it put five
 * other destinations between the shopper and the one action the screen exists
 * for. Cart keeps its place in the bar from every other tab; it just does not
 * draw the bar over its own checkout.
 */
const NAV_HIDDEN_ON = ["cart"];

/**
 * Tabs the concierge bubble stays off.
 *
 * `cart` ends in a total and a "Secure checkout" button in the bottom-right —
 * exactly where the bubble sits, and exactly the control the screen exists for.
 * `community` is a full-screen conversation whose message composer owns that
 * corner, and which hides the nav for the same reason.
 *
 * Hidden rather than nudged aside: an offset is a guess about content that will
 * change, and the website already shipped this mistake — see the note in
 * `components/concierge-fab.tsx`.
 */
const CONCIERGE_HIDDEN_ON = ["cart", "community"];
export default function TabsLayout() {
  return (
    // Wraps the navigator, so it is above BOTH the screens that report their
    // scrolling and the `tabBar` that renders the bubble reading it.
    <ScrollRevealProvider>
      <Tabs
        tabBar={(props) => {
          const active = props.state.routes[props.state.index]?.name ?? "";

          return (
            <>
              {CONCIERGE_HIDDEN_ON.includes(active) ? null : <ConciergeFab />}
              {NAV_HIDDEN_ON.includes(active) ? null : <GlassNav {...props} />}
            </>
          );
        }}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="shop" options={{ title: "Shop" }} />
        <Tabs.Screen name="cart" options={{ title: "Cart" }} />
        <Tabs.Screen name="community" options={{ title: "Community" }} />
        <Tabs.Screen name="wallet" options={{ title: "Wallet", href: null }} />
        <Tabs.Screen name="profile" options={{ title: "Account" }} />
      </Tabs>
    </ScrollRevealProvider>
  );
}
