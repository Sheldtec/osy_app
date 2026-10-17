import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { AccountShell, Empty, Failed, Loading, Panel, Pill } from "@/components/account-ui";
import { Field, Notice } from "@/components/checkout-ui";
import { Txt } from "@/components/ui";
import { claimCoupon, getCoupons, type CouponCard, type CouponWallet } from "@/lib/account-api";
import { couponLabels } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/theme-context";

/**
 * My codes.
 *
 * The list is not only codes the customer has claimed — the server also returns
 * every live public coupon they qualify for, so a valid offer surfaces without
 * them having to be told it exists.
 */

type Tab = "available" | "used" | "expired";

export default function CouponsScreen() {
  const theme = useTheme();
  const money = useApproxMoney();
  const [wallet, setWallet] = useState<CouponWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("available");

  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | undefined>();
  const [claimed, setClaimed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWallet(await getCoupons());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your codes.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    const value = code.trim();
    if (!value) return;
    setClaiming(true);
    setClaimError(undefined);
    setClaimed(null);
    try {
      const res = await claimCoupon(value);
      setClaimed(
        res.already
          ? `${res.coupon.code} is already in your codes.`
          : `${res.coupon.code} added — ${couponLabels(res.coupon, money).discount}.`,
      );
      setCode("");
      await load();
    } catch (err) {
      setClaimError(
        err instanceof ApiError
          ? (err.fieldError("code") ?? err.message)
          : "That code could not be added.",
      );
    } finally {
      setClaiming(false);
    }
  }

  /**
   * App-channel codes are hidden.
   *
   * CouponService::evaluate() is called without its `$channel` argument from
   * both call sites, so it always evaluates as "web" — an `app` coupon is
   * rejected in the app with "This code can only be used in the OsyGentle app."
   * Showing one here would be offering a code that cannot be redeemed.
   */
  const visible = (list: CouponCard[]) => list.filter((c) => c.channel !== "app");

  const lists: Record<Tab, CouponCard[]> = {
    available: visible(wallet?.available ?? []),
    used: visible(wallet?.used ?? []),
    expired: visible(wallet?.expired ?? []),
  };
  const current = lists[tab];

  return (
    <AccountShell
      title="My codes"
      subtitle="Discounts you hold, and offers you already qualify for."
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      {/* ---- add a code ---- */}
      <Panel style={{ marginTop: 18 }}>
          <Field
            account
            label="Have a code?"
            value={code}
            onChangeText={(v) => {
              setCode(v.toUpperCase());
              setClaimError(undefined);
            }}
            placeholder="OSY20"
            autoCapitalize="characters"
            autoCorrect={false}
            error={claimError}
            trailing={
              <Pressable
                onPress={() => void claim()}
                disabled={claiming || !code.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add this code"
                hitSlop={10}
                style={({ pressed }) => [
                  (claiming || !code.trim()) && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Txt tone="primary" size={12.5} weight="medium">
                  {claiming ? "…" : "Add"}
                </Txt>
              </Pressable>
            }
          />
          {claimed ? (
            <View style={{ marginTop: 10 }}>
              <Notice tone="success">{claimed}</Notice>
            </View>
          ) : null}
      </Panel>

      {wallet === null && error === null ? <Loading label="Loading your codes…" /> : null}
      {error && wallet === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {wallet ? (
        <>
          {/* ---- tabs ---- */}
          <View style={styles_tabs(theme)}>
            {(["available", "used", "expired"] as Tab[]).map((t) => {
              const active = t === tab;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles_tab,
                    active && { backgroundColor: theme.colors.surface },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Txt
                    tone={active ? "primary" : "body"}
                    size={10}
                    weight={active ? "medium" : "regular"}
                  >
                    {t === "available" ? "Available" : t === "used" ? "Used" : "Expired"}
                    {lists[t].length ? ` ${lists[t].length}` : ""}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {current.length === 0 ? (
            <Empty
              title={
                tab === "available"
                  ? "No codes right now"
                  : tab === "used"
                    ? "Nothing used yet"
                    : "Nothing expired"
              }
              body={
                tab === "available"
                  ? "Offers you qualify for show up here automatically. If someone gave you a code, add it above."
                  : "Codes move here once they’ve been used or have run out of time."
              }
              action={
                tab === "available"
                  ? { label: "Browse the collection", onPress: () => router.replace("/shop") }
                  : undefined
              }
            />
          ) : (
            <>
              {current.map((c) => (
                <CouponRow key={c.id} coupon={c} />
              ))}
            </>
          )}
        </>
      ) : null}
    </AccountShell>
  );
}

function CouponRow({ coupon }: { coupon: CouponCard }) {
  const theme = useTheme();
  const money = useApproxMoney();
  /*
   * NOT `coupon.discount_label` / `coupon.condition_label`.
   *
   * Those arrive from the server with a Naira sign already inside the string,
   * so they could never follow the shopper's chosen currency — this screen was
   * the clearest instance of the bug. The server now also sends the raw
   * `value`, `type` and `min_spend`, which is everything the two sentences are
   * made of, so they are assembled here instead.
   */
  const { discount, condition } = couponLabels(coupon, money);
  const spent = coupon.status !== "available";

  return (
    <Panel style={spent ? { opacity: 0.6 } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Txt tone="primary" display size={18}>
              {discount}
            </Txt>
            {coupon.badge ? <Pill label={coupon.badge} tone="warn" /> : null}
            {coupon.status === "used" ? <Pill label="Used" tone="mute" /> : null}
            {coupon.status === "expired" ? <Pill label="Expired" tone="bad" /> : null}
          </View>

          {coupon.description ? (
            <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
              {coupon.description}
            </Txt>
          ) : null}

          {coupon.condition_label ? (
            <Txt tone="body" size={9} style={{ marginTop: 6 }}>
              {condition}
            </Txt>
          ) : null}

          {coupon.min_spend ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              Spend at least {money(coupon.min_spend)}
            </Txt>
          ) : null}

          {coupon.ends_at && coupon.status === "available" ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              Use by {endsOn(coupon.ends_at)}
            </Txt>
          ) : null}
        </View>
      </View>

      <View style={styles_codeRow(theme)}>
        <Txt tone="strong" size={12} weight="medium" selectable style={{ letterSpacing: 1.2 }}>
          {coupon.code}
        </Txt>
        {!spent ? (
          <Txt tone="body" size={9}>
            Enter at checkout
          </Txt>
        ) : null}
      </View>
    </Panel>
  );
}

function endsOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const styles_tabs = (t: Theme) => ({
  flexDirection: "row" as const,
  marginTop: 24,
  padding: 4,
  borderRadius: 13,
  backgroundColor: t.surfaces.segmentTrack,
});

const styles_tab = {
  flex: 1,
  height: 36,
  borderRadius: 10,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const styles_codeRow = (t: Theme) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  marginTop: 14,
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: t.surfaces.lineSoft,
});
