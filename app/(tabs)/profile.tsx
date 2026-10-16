import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NAV_CLEARANCE } from "@/components/glass-nav";
import { getMyOrders, ORDER_BUCKETS, type Order } from "@/lib/account-api";
import { useWishlist } from "@/lib/wishlist";
import {
  AccountIconBg,
  BadgeCount,
  ChevronRight,
  IconAddressBook,
  IconBell,
  IconGift,
  IconEdit,
  IconHelp,
  IconPayment,
  IconPreferences,
  IconProcessing,
  IconReview,
  IconRewards,
  IconSettings,
  IconShipped,
  IconSignOut,
  IconDelivery,
  IconTag,
  IconToPay,
  NavWallet,
  IconVerified,
  IdentityAccent,
  OrderStatusBg,
  PROFILE_PHOTO,
  RewardsGlow,
  RewardsIconBg,
} from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useStorefrontSettings } from "@/lib/settings";
import { getPreorders } from "@/lib/preorders-api";
import { getSpecialOrders } from "@/lib/special-orders-api";
import { getUnreadCount } from "@/lib/notifications-api";
import { getWallet } from "@/lib/wallet";
import { naira } from "@/lib/format";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * Profile — Figma "Refined · 9 · Profile" (249:635).
 *
 * Signed out, the frame has nothing to show, so the screen offers the auth
 * sheet instead of rendering someone else's placeholder account.
 *
 * Numbers here are NOT invented, and that rule has outlived its original
 * reason. It was written when none of these endpoints existed and every count
 * rendered as zero; most of them are real now — order counts, the pre-order
 * and special-order badges, unread notifications, and the store credit under
 * the identity card all come from the server.
 *
 * What survives is the discipline: a figure that has not loaded shows a dash,
 * not a zero (see `balance`), and anything still unbuilt says what it is
 * waiting for rather than showing a plausible number. The LOYALTY TIER that
 * used to sit under the identity card was the last of those placeholders — a
 * named tier and a progress bar pinned at zero for a programme that does not
 * exist — and it was replaced (owner direction 2026-10-16) by the wallet
 * balance and its two actions.
 */
const GUTTER = layout.gutter;

/**
 * The four tiles, counted from the customer's real orders.
 *
 * These shipped hard-coded to zero with a "View all" that had no handler, so
 * the whole section was decoration.
 *
 * The matching lives in ORDER_BUCKETS, shared with the orders screen's filter
 * — the tile and the list it opens have to agree on what "Processing" means,
 * and two private copies of that is how they stop agreeing. Only the icon and
 * the tile's own wording are local: the frame labels the delivered bucket
 * "Review", because by then the thing worth doing is reviewing it.
 */
const bucket = (key: string) => ORDER_BUCKETS.find((b) => b.key === key)!;

const ORDER_STATUSES = [
  { key: "to-pay", label: "To pay", Icon: IconToPay, match: bucket("to-pay").match },
  { key: "processing", label: "Processing", Icon: IconProcessing, match: bucket("processing").match },
  { key: "shipped", label: "Shipped", Icon: IconShipped, match: bucket("shipped").match },
  { key: "delivered", label: "Review", Icon: IconReview, match: bucket("delivered").match },
] as const;

/**
 * Every row here goes somewhere.
 *
 * The previous set — Address book, Payment methods, Preferences — had no
 * screens behind them and no handlers on the rows, so tapping any of them did
 * nothing. A row that cannot be followed is worse than no row.
 */
const ACCOUNT_ROWS = [
  {
    key: "details",
    label: "My details",
    sub: "Name, phone, birthday and address",
    Icon: IconEdit,
    href: "/account/profile",
  },
  {
    key: "wishlist",
    label: "Saved pieces",
    sub: "Kept on this device",
    Icon: IconAddressBook,
    href: "/account/wishlist",
  },
  {
    key: "coupons",
    label: "My codes",
    sub: "Discounts and offers you qualify for",
    Icon: IconPayment,
    href: "/account/coupons",
  },
  {
    key: "hair-profile",
    label: "Hair profile",
    sub: "Measurements and what suits you",
    Icon: IconPreferences,
    href: "/account/hair-profile",
  },
  {
    key: "vip",
    label: "OG VIP",
    sub: "Our trade membership",
    Icon: IconPreferences,
    href: "/account/vip",
  },
  {
    key: "address",
    label: "Saved address",
    sub: "Where your orders are delivered",
    Icon: IconAddressBook,
    // The same screen as My details: there is ONE delivery address on the
    // account, not an address book. It gets its own row because "address" is
    // the word people look for, not "details".
    href: "/account/profile",
  },
  {
    key: "special-orders",
    label: "Special orders",
    sub: "Ask us to source a piece",
    Icon: IconPreferences,
    href: "/account/special-orders",
  },
  {
    key: "preorders",
    label: "Pre-orders",
    sub: "Pieces reserved from a coming batch",
    Icon: IconToPay,
    href: "/account/preorders",
    /** Hidden when the owner switches pre-ordering off. */
    flag: "preorder",
  },
  {
    key: "currency",
    label: "Currency",
    sub: "What prices are shown in",
    Icon: IconTag,
    href: "/account/currency",
  },
  {
    key: "notifications",
    label: "Notifications",
    sub: "Order updates and account news",
    Icon: IconBell,
    href: "/account/notifications",
  },
  {
    key: "referrals",
    label: "Invite a friend",
    sub: "Share your code, earn store credit",
    Icon: IconGift,
    href: "/account/referrals",
  },
  {
    key: "try-on",
    label: "Try it on",
    sub: "See a piece on your own photo",
    Icon: IconPreferences,
    href: "/try-on",
    /** Hidden entirely when the owner switches the app's studio off. */
    flag: "face_match_app",
  },
] as const;

/**
 * The shortcut row under the order statuses.
 *
 * Same shape as the order tiles on purpose — these are the other four things
 * with a number worth glancing at. `badge` is what needs the customer's
 * attention, not a total: a quote waiting to be accepted, a deposit still
 * owing. A tile with nothing pending shows no badge at all.
 */
const QUICK_TILES = [
  { key: "wallet", label: "Wallet", Icon: NavWallet, href: "/wallet" },
  { key: "preorders", label: "Pre-orders", Icon: IconDelivery, href: "/account/preorders" },
  { key: "special", label: "Special", Icon: IconTag, href: "/account/special-orders" },
  { key: "saved", label: "Saved", Icon: IconAddressBook, href: "/account/wishlist" },
] as const;

export default function ProfileScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The order counts behind the four tiles. A failure leaves them at zero,
  // which is what they always showed anyway — it must never block the screen.
  const [orders, setOrders] = useState<Order[]>([]);
  const wishlist = useWishlist();
  const { features } = useStorefrontSettings();

  /**
   * Badge counts for the shortcut row.
   *
   * Every one of these is best-effort: a failure leaves the badge at zero,
   * exactly as the order tiles behave, because a profile screen must never
   * fail to render because a side count did not load.
   */
  const [pending, setPending] = useState({ preorders: 0, special: 0, unread: 0 });
  /**
   * Store credit, for the strip under the identity card.
   *
   * `null` means "not known yet" and is NOT the same as zero — a balance is
   * money, so the strip shows a dash until the server has actually answered
   * rather than flashing ₦0 at someone who has credit.
   */
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const [pre, spec, notes, wal] = await Promise.all([
        getPreorders().catch(() => []),
        getSpecialOrders().catch(() => []),
        // The cheap COUNT endpoint — about twelve bytes, and the only
        // notification route meant to be read this way.
        getUnreadCount().catch(() => ({ unread: 0 })),
        // Returns null rather than throwing when it cannot be read.
        getWallet().catch(() => null),
      ]);
      if (!alive) return;

      setBalance(wal ? wal.balance : null);

      setPending({
        // Owing money, not merely existing — that is what deserves a badge.
        preorders: pre.filter((p) => p.balance_due > 0 && p.status !== "cancelled").length,
        // A quote waiting on the customer.
        special: spec.filter((r) => r.status === "quoted").length,
        unread: notes.unread,
      });
    })();

    return () => {
      alive = false;
    };
  }, []);

  /**
   * The rows this shop actually offers.
   *
   * A row with a `flag` is dropped when the owner has that feature switched
   * off for the app, rather than shown and then refused by the screen behind
   * it. Before the flags arrive they are all treated as off, so a gated row
   * appears a moment late instead of appearing and then vanishing.
   */
  const rows = ACCOUNT_ROWS.filter(
    (row) => !("flag" in row) || features[row.flag as keyof typeof features],
  );

  const loadOrders = useCallback(() => {
    getMyOrders()
      .then(setOrders)
      .catch(() => setOrders([]));
  }, []);

  useEffect(loadOrders, [loadOrders]);

  const insets = useSafeAreaInsets();
  const { user, loading, signOut } = useAuth();

  if (loading) return <View style={{ flex: 1, backgroundColor: theme.surfaces.cart }} />;

  if (!user) return <SignedOut insets={insets} />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.surfaces.cart }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + NAV_CLEARANCE,
        paddingHorizontal: GUTTER,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* ---- header ---- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt tone="strong" display size={28}>
            My account
          </Txt>
          <Txt tone="body" size={12} style={{ marginTop: 8 }}>
            Welcome back, {user.name.split(" ")[0]}
          </Txt>
        </View>
        <Pressable
          onPress={() => router.push("/account/settings")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={({ pressed }) => [styles.settings, pressed && { opacity: 0.7 }]}
        >
          <IconSettings width={20} height={20} color={theme.colors.primaryOn} />
        </Pressable>
      </View>

      {/* ---- identity ---- */}
      <View style={styles.identity}>
        <IdentityAccent width={170} height={170} style={styles.identityAccent} />

        <View style={styles.identityTop}>
          <Image
            source={user.avatar ? { uri: user.avatar } : PROFILE_PHOTO}
            style={styles.avatar}
            contentFit="cover"
            accessibilityLabel={user.name}
          />

          <View style={{ flex: 1, marginLeft: 18 }}>
            <Txt tone="strong" weight="medium" size={18} numberOfLines={1}>
              {user.name}
            </Txt>
            <Txt tone="body" size={11} style={{ marginTop: 6 }} numberOfLines={1}>
              {user.email}
            </Txt>

            <View style={styles.verified}>
              <IconVerified width={13} height={13} color={theme.colors.primaryOn} />
              <Text style={styles.verifiedText}>VERIFIED MEMBER</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={({ pressed }) => [styles.edit, pressed && { opacity: 0.85 }]}
          >
            <IconEdit width={14} height={14} />
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
        </View>

        <View style={styles.identityDivider} />

        {/* Store credit, where the loyalty tier used to sit.
            That block advertised a programme that does not exist and showed a
            progress bar pinned at zero. This is the same real estate spent on
            something real: what you can spend, and the two things you would
            want to do about it.

            Deliberately in NAIRA even when a display currency is chosen — the
            amount is spendable credit and the Add-money form it leads to takes
            whole Naira, so converting one side would be a lie about the
            other. */}
        <View style={styles.wallet}>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletLabel}>STORE CREDIT</Text>
            <Txt tone="strong" display size={22} style={{ marginTop: 3 }}>
              {balance === null ? "—" : naira(balance)}
            </Txt>
          </View>

          <Pressable
            onPress={() => router.push("/wallet")}
            accessibilityRole="button"
            accessibilityLabel="Open my wallet"
            style={({ pressed }) => [styles.walletBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.walletBtnText}>Wallet</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/account/wallet-topup")}
            accessibilityRole="button"
            accessibilityLabel="Add money to my wallet"
            style={({ pressed }) => [
              styles.walletBtn,
              styles.walletBtnStrong,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.walletBtnText, { color: "#FFFFFF" }]}>Add money</Text>
          </Pressable>
        </View>
      </View>

      {/* ---- orders ---- */}
      <View style={styles.sectionHead}>
        <Txt tone="strong" weight="medium" size={17} style={{ flex: 1 }}>
          My orders
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all my orders"
          onPress={() => router.push("/account/orders")}
          style={({ pressed }) => [styles.viewAll, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.viewAllText}>View all</Text>
        </Pressable>
      </View>

      <View style={styles.orderCard}>
        {ORDER_STATUSES.map((status) => {
          const count = orders.filter(status.match).length;
          return (
          <Pressable
            key={status.key}
            accessibilityRole="button"
            accessibilityLabel={`${status.label}, ${count} ${count === 1 ? "order" : "orders"}`}
            onPress={() =>
              router.push({ pathname: "/account/orders", params: { status: status.key } })
            }
            style={({ pressed }) => [styles.orderTile, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.orderIcon}>
              <status.Icon width={22} height={22} color={theme.colors.primaryOn} />
              {count > 0 ? (
                <View style={styles.orderBadge}>
                  <BadgeCount width={18} height={18} />
                  <Text style={styles.orderBadgeText}>{count}</Text>
                </View>
              ) : null}
            </View>
            <Txt tone="strong" size={10} center style={{ marginTop: 10 }}>
              {status.label}
            </Txt>
          </Pressable>
          );
        })}
      </View>

      {/* ---- the shortcut row ---- */}
      <View style={styles.orderCard}>
        {QUICK_TILES.filter((t) => t.key !== "preorders" || features.preorder).map((tile) => {
          const badge =
            tile.key === "preorders"
              ? pending.preorders
              : tile.key === "special"
                ? pending.special
                : tile.key === "saved"
                  ? wishlist.items.length
                  : 0;

          return (
            <Pressable
              key={tile.key}
              accessibilityRole="button"
              accessibilityLabel={
                badge > 0 ? `${tile.label}, ${badge} needing attention` : tile.label
              }
              onPress={() => router.push(tile.href)}
              style={({ pressed }) => [styles.orderTile, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.orderIcon}>
                <tile.Icon width={20} height={20} color={theme.colors.primaryOn} />
                {badge > 0 ? (
                  <View style={styles.orderBadge}>
                    <BadgeCount width={18} height={18} />
                    <Text style={styles.orderBadgeText}>{badge}</Text>
                  </View>
                ) : null}
              </View>
              <Txt tone="strong" size={10} center style={{ marginTop: 10 }}>
                {tile.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {/* ---- rewards ---- */}
      <LinearGradient
        colors={["#3D1457", "#784094"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.rewards}
      >
        <RewardsGlow width={130} height={130} style={styles.rewardsGlow} />

        <View style={styles.rewardsIcon}>
          <RewardsIconBg width={46} height={46} />
          <IconRewards width={22} height={22} style={styles.rewardsGlyph} />
        </View>

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.rewardsTitle}>OsyGentle Rewards</Text>
          <Text style={styles.rewardsAmount}>{naira(0)} available</Text>
          <Text style={styles.rewardsCaption}>Earn credit on every order</Text>
        </View>
      </LinearGradient>

      {/* ---- account & preferences ---- */}
      <Text style={styles.overline}>ACCOUNT &amp; PREFERENCES</Text>

      <View style={styles.accountCard}>
        {rows.map((row, i) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            onPress={() => router.push(row.href)}
            style={({ pressed }) => [styles.accountRow, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.accountIcon}>
              <row.Icon width={18} height={18} color={theme.colors.primaryOn} />
            </View>

            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt tone="strong" weight="medium" size={11}>
                {row.label}
              </Txt>
              <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                {row.key === "wishlist" && wishlist.items.length
                  ? `${wishlist.items.length} saved on this device`
                  : row.key === "notifications" && pending.unread
                    ? `${pending.unread} unread`
                    : row.sub}
              </Txt>
            </View>

            <ChevronRight width={18} height={18} />
            {i < rows.length - 1 ? <View style={styles.accountDivider} /> : null}
          </Pressable>
        ))}
      </View>

      {/* ---- help + sign out ---- */}
      <View style={styles.footerRow}>
        <Pressable
          onPress={() => router.push("/concierge")}
          accessibilityRole="button"
          accessibilityLabel="Help centre and concierge"
          style={({ pressed }) => [styles.help, pressed && { opacity: 0.8 }]}
        >
          <View style={styles.accountIcon}>
            <IconHelp width={18} height={18} color={theme.colors.primaryOn} />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Txt tone="strong" weight="medium" size={11}>
              Help centre
            </Txt>
            <Txt tone="body" size={9} style={{ marginTop: 3 }}>
              Ask the concierge, or reach the team
            </Txt>
          </View>
          <ChevronRight width={18} height={18} />
        </Pressable>

        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.8 }]}
        >
          <IconSignOut width={18} height={18} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** No account yet — offer the sheet rather than a hollow dashboard. */
function SignedOut({ insets }: { insets: { top: number; bottom: number } }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaces.cart,
        paddingTop: insets.top + 48,
        paddingHorizontal: GUTTER,
        paddingBottom: insets.bottom + NAV_CLEARANCE,
      }}
    >
      <Txt tone="strong" display size={28}>
        My account
      </Txt>
      <Txt tone="body" size={12} style={{ marginTop: 8, lineHeight: 19 }}>
        Sign in to follow your orders, keep your saved pieces, and spend store credit.
      </Txt>

      <GradientButton
        label="Log in or create an account"
        style={{ marginTop: 28 }}
        onPress={() => router.push("/auth")}
      />
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", marginTop: 8 },
  settings: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  identity: {
    backgroundColor: t.colors.surface,
    borderRadius: 24,
    padding: 18,
    marginTop: 20,
    overflow: "hidden",
  },
  identityAccent: { position: "absolute", right: -60, top: -75 },
  identityTop: { flexDirection: "row", alignItems: "flex-start" },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  verified: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: t.surfaces.verifiedTint,
    marginTop: 10,
  },
  verifiedText: { fontFamily: fonts.medium, fontSize: 9, color: t.colors.primaryOn },
  edit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.colors.primary,
  },
  editText: { fontFamily: fonts.medium, fontSize: 10, color: "#FFFFFF" },
  identityDivider: { height: 1, backgroundColor: t.surfaces.lineSoft, marginVertical: 14 },

  wallet: { flexDirection: "row", alignItems: "center", gap: 8 },
  walletLabel: {
    fontFamily: fonts.medium,
    fontSize: 8.5,
    letterSpacing: 1.3,
    color: t.textInk.faint,
  },
  walletBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  walletBtnStrong: { backgroundColor: t.colors.primary },
  walletBtnText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },


  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 26 },
  viewAll: {
    height: 30,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  viewAllText: { fontFamily: fonts.medium, fontSize: 10, color: t.colors.primaryOn },

  orderCard: {
    flexDirection: "row",
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    paddingVertical: 15,
    marginTop: 14,
  },
  orderTile: { flex: 1, alignItems: "center" },
  orderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  orderBadge: { position: "absolute", top: -6, right: -6, alignItems: "center", justifyContent: "center" },
  orderBadgeText: { position: "absolute", fontFamily: fonts.medium, fontSize: 9, color: "#FFFFFF" },

  rewards: {
    flexDirection: "row",
    alignItems: "center",
    height: 86,
    borderRadius: 20,
    paddingHorizontal: 16,
    marginTop: 22,
    overflow: "hidden",
  },
  rewardsGlow: { position: "absolute", right: -20, top: -47 },
  rewardsIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  rewardsGlyph: { position: "absolute" },
  rewardsTitle: { fontFamily: fonts.medium, fontSize: 13, color: "#FFFFFF" },
  rewardsAmount: { fontFamily: fonts.display, fontSize: 17, color: "#FFFFFF", marginTop: 4 },
  rewardsCaption: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: "rgba(255,255,255,0.82)",
    marginTop: 4,
  },

  overline: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.body,
    marginTop: 26,
  },
  accountCard: { backgroundColor: t.colors.surface, borderRadius: 20, marginTop: 12 },
  accountRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  accountIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  accountDivider: {
    position: "absolute",
    left: 60,
    right: 14,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.segmentTrack,
  },

  footerRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  help: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: t.colors.surface,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: 128,
    height: 56,
    borderRadius: 18,
    backgroundColor: t.colors.dangerBg,
  },
  signOutText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.danger },
});
