import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  SectionLabel,
} from "@/components/account-ui";
import { Field } from "@/components/checkout-ui";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { cancelWithdrawal, getWallet, requestWithdrawal } from "@/lib/wallet";
import type { Wallet, WalletWithdrawal } from "@/lib/types";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Cash out earned income.
 *
 * The ceiling is `wallet.withdrawable`, NOT the balance — only cleared referral
 * and resale earnings can leave the shop. Store credit the shop issued (the
 * welcome credit, a refund, a goodwill top-up) is spendable here and is not
 * cash, and a screen that offered the whole balance would be promising money
 * the server will refuse.
 *
 * The figure shown is a courtesy. The server recomputes it under a row lock
 * when the request lands, which is what actually stops two concurrent requests
 * both passing.
 *
 * A successful request DEBITS IMMEDIATELY as a hold. A person pays it out; a
 * rejection refunds it. That is stated on screen, because seeing a balance drop
 * before any money has arrived is otherwise alarming.
 */

const STATUS: Record<
  WalletWithdrawal["status"],
  { label: string; tone: "ok" | "warn" | "bad" | "mute" }
> = {
  pending: { label: "In review", tone: "warn" },
  paid: { label: "Paid out", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "mute" },
};

export default function WalletWithdrawScreen() {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const w = await getWallet();
    setWallet(w);
    setLoadFailed(w === null);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const value = Math.round(Number(amount.replace(/[^\d]/g, "")) || 0);
  const ceiling = wallet?.withdrawable ?? 0;
  const min = wallet?.withdrawal_min ?? 2_000;

  async function submit() {
    setError(null);
    setFields({});
    setDone(false);

    const local: Record<string, string> = {};
    if (value < min) local.amount = `The minimum cash-out is ${naira(min)}.`;
    else if (value > ceiling) local.amount = `That’s more than your withdrawable income of ${naira(ceiling)}.`;
    if (bankName.trim().length < 2) local.bank_name = "Which bank is it?";
    if (!/^\d{8,20}$/.test(accountNumber.trim())) local.account_number = "Enter the account number — digits only.";
    if (accountName.trim().length < 2) local.account_name = "Whose name is on the account?";

    if (Object.keys(local).length) {
      setFields(local);

      return;
    }

    setBusy(true);
    try {
      await requestWithdrawal({ amount: value, bankName, accountNumber, accountName });
      setDone(true);
      setAmount("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const k of ["amount", "bank_name", "account_number", "account_name"]) {
          const msg = err.fieldError(k);
          if (msg) map[k] = msg;
        }
        setFields(map);
        if (Object.keys(map).length === 0) setError(err.message);
      } else {
        setError("That request didn’t go through. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: number) {
    setError(null);
    try {
      await cancelWithdrawal(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t cancel that request.");
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Cash out" subtitle="Move earned income to your bank.">
        <Empty
          title="Sign in first"
          body="Earnings belong to an account, so you’ll need to be signed in to withdraw them."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  const off = wallet !== null && !wallet.withdrawals_enabled;
  const nothingToTake = wallet !== null && ceiling < min;

  return (
    <AccountShell
      title="Cash out"
      subtitle="Referral and resale earnings, paid to your bank."
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
      footerSpace={120}
      footer={
        wallet && !off && !nothingToTake ? (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
            <GradientButton
              label={busy ? "Sending…" : "Request cash-out"}
              disabled={busy}
              onPress={() => void submit()}
            />
          </View>
        ) : null
      }
    >
      {wallet === null && !loadFailed ? <Loading label="Checking your earnings…" /> : null}

      {loadFailed ? (
        <Failed message="We couldn’t load your wallet." onRetry={() => void load()} />
      ) : null}

      {wallet ? (
        <>
          <Panel>
            <Text style={s.ceilingLabel}>AVAILABLE TO CASH OUT</Text>
            <Txt tone="strong" display size={30} style={{ marginTop: 6 }}>
              {naira(ceiling)}
            </Txt>
            <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
              Your balance is {naira(wallet.balance)}, of which {naira(wallet.income_earned)} has
              been earned from referrals and resale. Only earned income can be cashed out — store
              credit is spent in the shop.
            </Txt>
          </Panel>

          {off ? (
            <Panel style={{ marginTop: 16 }}>
              <Txt tone="strong" size={12} weight="medium">
                Cash-outs are paused
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                We’ve turned withdrawals off for the moment. Your balance is untouched and you can
                still spend it in the shop.
              </Txt>
            </Panel>
          ) : nothingToTake ? (
            <Panel style={{ marginTop: 16 }}>
              <Txt tone="strong" size={12} weight="medium">
                Nothing to cash out yet
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                You need at least {naira(min)} of earned income. Refer a friend, or sell a piece on
                Thrift, and it will appear here.
              </Txt>
            </Panel>
          ) : (
            <>
              <SectionLabel>HOW MUCH</SectionLabel>
              <Panel>
                <Field
                  account
                  label="Amount"
                  value={amount}
                  onChangeText={setAmount}
                  placeholder={String(min)}
                  keyboardType="number-pad"
                  hint={`Between ${naira(min)} and ${naira(ceiling)}.`}
                  error={fields.amount}
                />
              </Panel>

              <SectionLabel>WHERE IT GOES</SectionLabel>
              <Panel>
                <Field
                  account
                  label="Bank"
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="GTBank"
                  autoCapitalize="words"
                  error={fields.bank_name}
                />
                <Field
                  account
                  label="Account number"
                  value={accountNumber}
                  onChangeText={(v) => setAccountNumber(v.replace(/[^\d]/g, ""))}
                  placeholder="0123456789"
                  keyboardType="number-pad"
                  maxLength={20}
                  error={fields.account_number}
                  style={{ marginTop: 16 }}
                />
                <Field
                  account
                  label="Account name"
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="As it appears at your bank"
                  autoCapitalize="words"
                  error={fields.account_name}
                  style={{ marginTop: 16 }}
                />

                <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 14 }}>
                  The amount leaves your balance straight away and is held while we review it. If
                  we can’t pay it out, it goes back.
                </Txt>
              </Panel>
            </>
          )}

          {done ? (
            <Panel style={{ marginTop: 16, backgroundColor: theme.colors.successBg }}>
              <Txt tone="strong" size={12} weight="medium">
                Request received
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                It’s being reviewed. You’ll see it below, and the money reaches your bank once
                it’s approved.
              </Txt>
            </Panel>
          ) : null}

          {error ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          {/* ---- history ---- */}
          {wallet.withdrawals.length ? (
            <>
              <SectionLabel>YOUR CASH-OUTS</SectionLabel>
              {wallet.withdrawals.map((w) => {
                const st = STATUS[w.status] ?? { label: w.status, tone: "mute" as const };

                return (
                  <Panel key={w.id}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Txt tone="strong" display size={17} style={{ flex: 1 }}>
                        {naira(w.amount)}
                      </Txt>
                      <Pill label={st.label} tone={st.tone} />
                    </View>

                    <Txt tone="body" size={9} style={{ marginTop: 8, lineHeight: 14 }}>
                      {w.bank_name} · {w.account_hint} · {w.account_name}
                    </Txt>
                    <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                      {w.ref}
                      {w.paid_at ? ` · paid ${stamp(w.paid_at)}` : w.at ? ` · ${stamp(w.at)}` : ""}
                    </Txt>

                    {w.note ? (
                      <Txt tone="body" size={9} style={{ marginTop: 8, lineHeight: 14 }}>
                        {w.note}
                      </Txt>
                    ) : null}

                    {w.status === "pending" ? (
                      <Pressable
                        onPress={() => void withdraw(w.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel the ${naira(w.amount)} cash-out`}
                        style={({ pressed }) => [s.cancel, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={s.cancelText}>Cancel this request</Text>
                      </Pressable>
                    ) : null}
                  </Panel>
                );
              })}
            </>
          ) : null}
        </>
      ) : null}
    </AccountShell>
  );
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const makeS = (t: Theme) => StyleSheet.create({
  ceilingLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
  },
  cancel: {
    marginTop: 14,
    alignSelf: "flex-start",
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.danger },

  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: t.surfaces.cart },
});
