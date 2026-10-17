import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NAV_CLEARANCE } from "@/components/glass-nav";
import {
  ActivityIconBg,
  IconActivityBag,
  IconActivityGift,
  IconActivityPlus,
  IconActivitySale,
  IconAddMoney,
  IconBell,
  IconCashOut,
  WalletGlow,
  WalletRing,
} from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { signedMoney } from "@/lib/currency";
import { useScrollReveal } from "@/lib/scroll-reveal";
import { useApproxMoney } from "@/lib/currency-context";
import { useAuth } from "@/lib/auth";
import { claimWelcomeCredit, getWallet } from "@/lib/wallet";
import type { Wallet, WalletTransaction } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * Wallet — Figma "Refined · 4 · Wallet" (249:240).
 *
 * Balance card, three quick actions, a progress card and the activity ledger.
 * Every figure comes from GET /api/wallet; there is NO mock fallback and there
 * must not be one, because a balance is money — an invented ₦248.50 shown to
 * someone with an empty wallet is the worst thing this screen could do. Signed
 * out, or with the API unreachable, it says so.
 *
 * Departures from the frame, all for the same reason — the mockup was drawn
 * against a euro dataset and a feature set the API does not have:
 *
 *   · "Cashback progress" is replaced by the WELCOME CREDIT card, which is a
 *     real thing the API tracks (`welcome.eligible` / `.claimed`) and can be
 *     claimed from here. There is no cashback endpoint.
 *   · "Send" (peer-to-peer transfer) has no endpoint, so it is present but
 *     disabled and says why on press, rather than looking live.
 *   · Add money and Cash out route to their real flows; the API exposes
 *     /wallet/topup and /wallet/withdrawals, but both open payment and bank
 *     surfaces that are a screen of their own — so they explain rather than
 *     half-work.
 */
const GUTTER = layout.gutter;

export default function WalletScreen() {
  const reveal = useScrollReveal();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const money = useApproxMoney();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    const data = await getWallet();
    setWallet(data);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    setLoading(true);
    load().finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [authLoading, load, user?.id]);

  if (authLoading || loading) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.surfaces.cart }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!user) return <SignedOut insets={insets} />;
  if (!wallet) return <Unavailable insets={insets} onRetry={() => void load()} />;

  const welcome = wallet.welcome;

  async function claim() {
    setClaiming(true);
    setNotice(null);
    try {
      const { amount } = await claimWelcomeCredit();
      setNotice(`${money(amount)} added to your wallet.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The credit could not be claimed.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <ScrollView
      {...reveal.props}
      style={{ backgroundColor: theme.surfaces.cart }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + NAV_CLEARANCE,
        paddingHorizontal: GUTTER,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.primary}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt tone="strong" display size={28}>
            Wallet
          </Txt>
          <Txt tone="body" size={12} style={{ marginTop: 6 }}>
            Store credit, rewards and transfers
          </Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          style={styles.bell}
        >
          <IconBell width={42} height={42} />
        </Pressable>
      </View>

      {/* ---- balance ---- */}
      <LinearGradient
        colors={["#381252", "#612982", "#915CA8"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={styles.balance}
      >
        <WalletGlow width={190} height={190} style={styles.balanceGlow} />
        <WalletRing width={128} height={128} style={styles.balanceRing} />

        <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
        <Text style={styles.balanceValue}>{money(wallet.balance)}</Text>

        {wallet.withdrawable > 0 ? (
          <View style={styles.balancePill}>
            <Text style={styles.balancePillText}>
              {money(wallet.withdrawable)} available to cash out
            </Text>
          </View>
        ) : null}

        <View style={styles.balanceFoot}>
          <Text style={styles.balanceFootLabel}>STORE CREDIT ID</Text>
          <Text style={styles.balanceFootValue}>
            OGH · {(user.name.split(" ")[0] || "MEMBER").toUpperCase()} · {String(user.id).padStart(4, "0")}
          </Text>
        </View>
      </LinearGradient>

      {/* ---- quick actions ---- */}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/account/wallet-topup")}
          style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && { opacity: 0.9 }]}
        >
          <LinearGradient
            colors={["#4F1F6E", "#7A4599"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <IconAddMoney width={20} height={20} color="#FFFFFF" />
          <Text style={[styles.actionText, { color: "#FFFFFF" }]}>Add money</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={!wallet.withdrawals_enabled}
          onPress={() => {
            // The screen explains the ceiling properly, but saying it here
            // saves a tap when there is plainly nothing to take out.
            if (wallet.withdrawable < wallet.withdrawal_min) {
              setNotice(`Cash-out starts at ${money(wallet.withdrawal_min)} of earned income.`);

              return;
            }
            router.push("/account/wallet-withdraw");
          }}
          style={({ pressed }) => [
            styles.action,
            styles.actionIdle,
            !wallet.withdrawals_enabled && { opacity: 0.45 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <IconCashOut width={20} height={20} color={theme.colors.primary} />
          <Text style={styles.actionText}>Cash out</Text>
        </Pressable>

        {/* "Send" was in the Figma frame, but there is NO member endpoint for
            transferring credit to another member — the API has top-up,
            withdrawal and the welcome claim, and nothing else. Rather than
            keep a third control that can only ever apologise, the row is two
            real actions. If peer transfer is ever built server-side, this is
            where it goes. */}
      </View>

      {notice ? (
        <Txt tone="body" size={11} style={{ marginTop: 12 }}>
          {notice}
        </Txt>
      ) : null}

      {/* ---- welcome credit (the frame's "cashback progress" slot) ---- */}
      {welcome.enabled && !welcome.claimed ? (
        <View style={styles.welcome}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Txt tone="strong" weight="medium" size={13} style={{ flex: 1 }}>
              Welcome credit
            </Txt>
            <Txt tone="primary" weight="medium" size={11}>
              {money(welcome.amount)}
            </Txt>
          </View>
          <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            {welcome.eligible
              ? "Your profile is complete — claim it now."
              : "Complete your profile to unlock it."}
          </Txt>

          {welcome.eligible ? (
            <GradientButton
              label={claiming ? "Claiming…" : "Claim credit"}
              height={40}
              style={{ marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 22 }}
              disabled={claiming}
              onPress={() => void claim()}
            />
          ) : (
            <Pressable
              onPress={() => router.push("/profile")}
              accessibilityRole="button"
              style={({ pressed }) => [styles.welcomeLink, pressed && { opacity: 0.7 }]}
            >
              <Txt tone="primary" weight="medium" size={11}>
                Complete profile →
              </Txt>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* ---- activity ---- */}
      <View style={styles.sectionHead}>
        <Txt tone="strong" weight="medium" size={17} style={{ flex: 1 }}>
          Recent activity
        </Txt>
        <View style={styles.allPill}>
          <Text style={styles.allPillText}>All</Text>
        </View>
      </View>

      {wallet.transactions.length ? (
        <View style={styles.activity}>
          {wallet.transactions.slice(0, 12).map((t, i) => (
            <ActivityRow key={t.id} txn={t} bordered={i > 0} />
          ))}
        </View>
      ) : (
        <View style={styles.emptyActivity}>
          <Txt tone="strong" weight="medium" size={13} center>
            No activity yet
          </Txt>
          <Txt tone="body" size={11} center style={{ marginTop: 6, lineHeight: 16 }}>
            Refunds, referral rewards and resale income will appear here.
          </Txt>
        </View>
      )}
    </ScrollView>
  );
}

/** Pick the glyph that matches the ledger's `type`. */
function iconFor(type: string) {
  if (/refund|topup|credit/i.test(type)) return IconActivityPlus;
  if (/resale|sale|payout/i.test(type)) return IconActivitySale;
  if (/referral|welcome|reward|gift/i.test(type)) return IconActivityGift;
  return IconActivityBag;
}

function ActivityRow({ txn, bordered }: { txn: WalletTransaction; bordered: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const money = useApproxMoney();
  const Icon = iconFor(txn.type);
  const credit = txn.amount >= 0;

  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <View style={styles.rowIcon}>
        <Icon width={18} height={18} color={theme.colors.primaryOn} />
      </View>

      <View style={{ flex: 1, marginLeft: 12 }}>
        <Txt tone="strong" weight="medium" size={12} numberOfLines={1}>
          {txn.label || txn.type}
        </Txt>
        <Txt tone="body" size={10} style={{ marginTop: 4 }}>
          {formatDate(txn.at)}
        </Txt>
      </View>

      <Text style={[styles.amount, { color: credit ? theme.colors.success : theme.textInk.strong }]}>
        {signedMoney(money(Math.abs(txn.amount)), credit ? "+" : "−")}
      </Text>
    </View>
  );
}

function SignedOut({ insets }: { insets: { top: number; bottom: number } }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.state, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + NAV_CLEARANCE }]}>
      <Txt tone="strong" display size={28}>
        Wallet
      </Txt>
      <Txt tone="body" size={12} style={{ marginTop: 8, lineHeight: 19 }}>
        Sign in to see your store credit, referral rewards and resale income.
      </Txt>
      <GradientButton
        label="Log in or create an account"
        style={{ marginTop: 26 }}
        onPress={() => router.push("/auth")}
      />
    </View>
  );
}

function Unavailable({
  insets,
  onRetry,
}: {
  insets: { top: number; bottom: number };
  onRetry: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.state, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + NAV_CLEARANCE }]}>
      <Txt tone="strong" display size={22}>
        We could not load your wallet
      </Txt>
      <Txt tone="body" size={12} style={{ marginTop: 8, lineHeight: 19 }}>
        A balance is money, so nothing is shown rather than a guess. Check your connection and
        try again.
      </Txt>
      <GradientButton label="Try again" style={{ marginTop: 24 }} onPress={onRetry} />
    </View>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const makeStyles = (t: Theme) => StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  state: { flex: 1, backgroundColor: t.surfaces.cart, paddingHorizontal: GUTTER },

  header: { flexDirection: "row", alignItems: "flex-start", marginTop: 8 },
  bell: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },

  balance: { height: 206, borderRadius: 26, marginTop: 20, padding: 22, overflow: "hidden" },
  balanceGlow: { position: "absolute", right: -60, top: -40 },
  balanceRing: { position: "absolute", right: -20, top: 52 },
  balanceLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 0.8,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  balanceValue: {
    fontFamily: fonts.display,
    fontSize: 36,
    color: "#FFFFFF",
    marginTop: 10,
    includeFontPadding: false,
  },
  balancePill: {
    alignSelf: "flex-start",
    marginTop: 14,
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.14)",
    justifyContent: "center",
  },
  balancePillText: { fontFamily: fonts.medium, fontSize: 10, color: "#FFFFFF" },
  balanceFoot: {
    position: "absolute",
    left: 22,
    right: 22,
    bottom: 20,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  balanceFootLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.82)",
  },
  balanceFootValue: { fontFamily: fonts.medium, fontSize: 11, color: "#FFFFFF" },

  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  action: {
    flex: 1,
    height: 68,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  actionPrimary: {},
  actionIdle: { backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.surfaces.line },
  actionText: { fontFamily: fonts.medium, fontSize: 11, color: t.textInk.strong },

  welcome: {
    marginTop: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    backgroundColor: t.colors.surface,
    padding: 17,
  },
  welcomeLink: { marginTop: 10, alignSelf: "flex-start" },

  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 26 },
  allPill: {
    height: 30,
    paddingHorizontal: 16,
    borderRadius: 15,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  allPillText: { fontFamily: fonts.medium, fontSize: 10, color: t.colors.primaryOn },

  activity: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    backgroundColor: t.colors.surface,
    paddingHorizontal: 13,
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  rowBordered: { borderTopWidth: 1, borderTopColor: t.surfaces.lineSoft },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.surfaces.actionTint,
    alignItems: "center",
    justifyContent: "center",
  },
  amount: { fontFamily: fonts.medium, fontSize: 12 },

  emptyActivity: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    backgroundColor: t.colors.surface,
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
});
