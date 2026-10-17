import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { signedMoney } from "@/lib/currency";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { getPreorders, payPreorder, type Preorder, type PreorderStatus } from "@/lib/preorders-api";
import { useStorefrontSettings } from "@/lib/settings";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Pieces reserved from a batch that has not arrived yet.
 *
 * Everything here is paid from the WALLET — the API has no gateway path for a
 * pre-order — so when the balance will not cover it the screen says so and
 * offers the top-up, rather than failing at the moment of payment.
 *
 * The buttons send a TYPE ("deposit" or "full"), never an amount. The server
 * computes the charge from its own figures and recomputes the status from the
 * money afterwards, so the response is read back rather than assumed.
 */

const STATUS: Record<PreorderStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  pending: { label: "Deposit due", tone: "warn" },
  deposit_paid: { label: "Reserved", tone: "ok" },
  paid: { label: "Paid in full", tone: "ok" },
  fulfilled: { label: "Delivered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export default function PreordersScreen() {
  const s = useThemedStyles(makeS);
  const money = useApproxMoney();
  const { code: currency } = useCurrency();
  const { signedIn } = useAuth();
  const { features, loading: gating } = useStorefrontSettings();

  const [rows, setRows] = useState<Preorder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      setRows(await getPreorders());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your pre-orders.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  async function pay(row: Preorder, type: "deposit" | "full") {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await payPreorder(row.id, type);
      // Status comes back recomputed from the money, so it is read, not assumed.
      setRows((prev) => (prev ?? []).map((p) => (p.id === row.id ? res.preorder : p)));
      setNotice(
        res.preorder.balance_due > 0
          ? `Deposit paid. ${money(res.preorder.balance_due)} left before it ships.`
          : "Paid in full — we’ll let you know the moment it lands.",
      );
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "That payment didn’t go through.");
    } finally {
      setBusyId(null);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Pre-orders" subtitle="Pieces you've reserved from a coming batch.">
        <Empty
          title="Sign in to see your pre-orders"
          body="A reservation belongs to an account, so you'll need to be signed in."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  // The owner can switch pre-order off for the app. Honour it, but still show
  // what someone already reserved — hiding a paid reservation would be worse
  // than hiding the way to make a new one.
  const off = !gating && !features.preorder;

  return (
    <AccountShell
      title="Pre-orders"
      subtitle="Reserved now, yours when the batch lands."
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
    >
      {rows === null && error === null ? <Loading label="Loading your pre-orders…" /> : null}
      {error && rows === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {rows?.length === 0 ? (
        <Empty
          title="Nothing reserved yet"
          body={
            off
              ? "Pre-ordering is switched off at the moment. Everything in stock is still available."
              : "When a piece is coming soon you can reserve it with a deposit, and we'll hold it for you."
          }
          action={
            off
              ? { label: "Browse the shop", onPress: () => router.replace("/shop") }
              : { label: "See what's coming", onPress: () => router.replace("/shop") }
          }
        />
      ) : null}

      {notice ? (
        <Panel style={{ marginTop: 4 }}>
          <Txt tone="body" size={11} style={{ lineHeight: 16 }}>
            {notice}
          </Txt>
        </Panel>
      ) : null}

      {rows?.map((row) => {
        const st = STATUS[row.status] ?? { label: row.status, tone: "mute" as const };
        // The preparation add-on used to arrive baked into the label as a
        // literal "(+₦35,000)" — the one frozen Naira figure on a screen where
        // everything else converts. It is a number now, so it goes through the
        // same formatter as the rest of the money here.
        const surcharge = row.preparation_surcharge ?? 0;
        const spec = row.variant.join(" · ");
        const variantLine = surcharge > 0 ? `${spec} (${signedMoney(money(surcharge), "+")})`.trim() : spec;
        const owing = row.balance_due > 0;
        const open = row.status !== "cancelled" && row.status !== "fulfilled";
        const busy = busyId === row.id;

        return (
          <Panel key={row.id}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
              <Txt tone="strong" weight="medium" size={11} style={{ flex: 1 }}>
                {row.ref}
              </Txt>
              <Pill label={st.label} tone={st.tone} />
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <Thumb src={row.image} seed={row.slug ?? row.ref} alt={row.name} />
              <View style={{ flex: 1 }}>
                <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 16 }}>
                  {row.name}
                </Txt>
                {variantLine ? (
                  <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
                    {variantLine}
                  </Txt>
                ) : null}
                <Txt tone="strong" display size={17} style={{ marginTop: 8 }}>
                  {money(row.total_amount)}
                </Txt>
                {row.qty > 1 ? (
                  <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                    {row.qty} × {money(row.unit_price)}
                  </Txt>
                ) : null}
              </View>
            </View>

            {/* ---- the money, stated plainly ---- */}
            <View style={s.money}>
              <Row label="Paid so far" value={money(row.amount_paid)} />
              {owing ? (
                <Row label="Still to pay" value={money(row.balance_due)} strong />
              ) : (
                <Row label="Outstanding" value="Nothing" strong />
              )}
              {row.release_at ? <Row label="Expected" value={stamp(row.release_at)} /> : null}
              {/*
               * The bridge to the real charge.
               *
               * The Pay buttons below convert like everything else, so without
               * this line a shopper reading dollars would see no Naira figure
               * anywhere before a wallet debit. Checkout states it the same way
               * for the same reason.
               */}
              {currency !== "NGN" && owing ? (
                <Txt tone="body" size={10} style={{ marginTop: 10 }}>
                  Charged in {naira(row.balance_due)}
                </Txt>
              ) : null}
            </View>

            {open && owing ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                {row.amount_paid < row.deposit_amount ? (
                  <Pressable
                    onPress={() => void pay(row, "deposit")}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay the ${money(row.deposit_amount)} deposit`}
                    style={({ pressed }) => [s.action, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={s.actionText}>
                      {busy ? "Paying…" : `Pay ${row.deposit_percent}% deposit`}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => void pay(row, "full")}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay the remaining ${money(row.balance_due)}`}
                  style={({ pressed }) => [s.action, s.actionStrong, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[s.actionText, { color: "#FFFFFF" }]}>
                    {busy ? "Paying…" : `Pay ${money(row.balance_due)}`}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {open && owing ? (
              <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 13 }}>
                Paid from your wallet.{" "}
                <Text
                  style={s.link}
                  onPress={() => router.push("/account/wallet-topup")}
                  accessibilityRole="link"
                >
                  Top up
                </Text>{" "}
                if you need to.
              </Txt>
            ) : null}

            {row.note ? (
              <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 13 }}>
                {row.note}
              </Txt>
            ) : null}
          </Panel>
        );
      })}
    </AccountShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const s = useThemedStyles(makeS);
  return (
    <View style={s.row}>
      <Txt tone="body" size={10} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt tone="strong" size={10} weight={strong ? "medium" : undefined}>
        {value}
      </Txt>
    </View>
  );
}

function stamp(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const makeS = (t: Theme) => StyleSheet.create({
  money: { marginTop: 14, gap: 7 },
  row: { flexDirection: "row", alignItems: "center" },

  action: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  actionStrong: { backgroundColor: t.colors.primary },
  actionText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  link: { color: t.colors.primaryOn, fontFamily: fonts.medium },
});
