import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountShell, Empty, Loading, Panel, SectionLabel } from "@/components/account-ui";
import { Field } from "@/components/checkout-ui";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { getPaymentMethods, type PaymentMethods } from "@/lib/checkout-api";
import {
  getWallet,
  startTopup,
  txRefFromPaymentUrl,
  verifyTopup,
  TOPUP_MAX,
  TOPUP_MIN,
  type BankInstructions,
  type TopupMethod,
} from "@/lib/wallet";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Add money to the wallet.
 *
 * The screen never credits anything. It creates a pending top-up, hands the
 * customer to the provider (or to our bank details), and then ASKS THE SERVER
 * what happened. `GET /payments/verify` re-checks with the provider and settles
 * the credit server-side; nothing the app believes can move a balance.
 *
 * Two outcomes that are easy to conflate and must not be:
 *   · `paid: false` means "we have not seen it yet" — a webhook can still land
 *     seconds later. It is never reported as a failure.
 *   · A bank transfer is ALWAYS unpaid at this point. It stays pending until a
 *     person confirms the money arrived, so the screen hands over the reference
 *     and says plainly that the credit follows confirmation.
 */

/** Amounts people actually top up with, so most never type anything. */
const QUICK = [5_000, 10_000, 25_000, 50_000, 100_000];

const METHODS: { key: TopupMethod; label: string; sub: string }[] = [
  { key: "flutterwave", label: "Card or transfer", sub: "Flutterwave · instant" },
  { key: "paystack", label: "Card or transfer", sub: "Paystack · instant" },
  { key: "bank_transfer", label: "Bank transfer", sub: "Credited once we confirm it" },
];

export default function WalletTopupScreen() {
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<TopupMethod>("flutterwave");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Set once a bank transfer has been started — the details to quote. */
  const [bank, setBank] = useState<BankInstructions | null>(null);
  /** Set after a gateway round trip, so the outcome is stated rather than guessed. */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Which methods the shop can actually take right now. */
  const [live, setLive] = useState<PaymentMethods | null>(null);

  useEffect(() => {
    getPaymentMethods()
      .then(setLive)
      // Not fatal: without it every method is offered and an unavailable one
      // is refused by the server with its own message.
      .catch(() => setLive(null));
  }, []);

  // Android's custom tab needs warming; both calls are Android-only and THROW
  // on web, so they are guarded rather than fired blind.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();

    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const value = Math.round(Number(amount.replace(/[^\d]/g, "")) || 0);
  const valid = value >= TOPUP_MIN && value <= TOPUP_MAX;

  const settle = useCallback(async (reference: string) => {
    try {
      const status = await verifyTopup(reference);
      if (status.paid) {
        setOutcome(`${naira(status.total)} is in your wallet.`);

        return;
      }
      // Not a failure. Say so precisely.
      setOutcome(
        "We haven’t seen that payment yet. If you completed it, give it a moment and pull to refresh your wallet.",
      );
    } catch (err) {
      setOutcome(
        err instanceof ApiError
          ? err.message
          : "We couldn’t check that payment. Your wallet will show it once it clears.",
      );
    }
  }, []);

  async function go() {
    setError(null);
    setOutcome(null);
    setBank(null);

    if (!valid) {
      setError(
        value < TOPUP_MIN
          ? `The smallest top-up is ${naira(TOPUP_MIN)}.`
          : `The largest single top-up is ${naira(TOPUP_MAX)}.`,
      );

      return;
    }

    setBusy(true);
    try {
      const started = await startTopup(value, method);

      if (started.instructions) {
        setBank(started.instructions);

        return;
      }

      if (!started.payment_url) {
        setError("The payment provider didn’t return a checkout link. Please try again.");

        return;
      }

      // Parsed from the link, NOT `started.ref`: verify resolves the
      // payment_ref and 404s on the WT- ref.
      const txRef = txRefFromPaymentUrl(started.payment_url);

      // openAuthSessionAsync, not openBrowserAsync: it is the only installed
      // API that closes the sheet on BOTH platforms when the provider
      // redirects back.
      await WebBrowser.openAuthSessionAsync(started.payment_url, Linking.createURL("/account/wallet"));

      // The sheet closing proves nothing about payment — only the server does.
      if (txRef) await settle(txRef);
      else {
        setOutcome(
          "We couldn’t read that payment's reference. If you paid, your wallet will show it shortly.",
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We couldn’t start that top-up. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <AccountShell title="Top up" subtitle="Add store credit to your wallet.">
        <Empty
          title="Sign in first"
          body="A wallet belongs to an account, so you’ll need to be signed in to add to one."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Top up"
      subtitle="Add store credit to spend on any order."
      footerSpace={120}
      footer={
        bank ? null : (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
            <GradientButton
              label={busy ? "Opening…" : value > 0 ? `Add ${naira(value)}` : "Add money"}
              disabled={busy || !valid}
              onPress={() => void go()}
            />
          </View>
        )
      }
    >
      {/* ---- the transfer we are waiting on ---- */}
      {bank ? (
        <>
          <Panel>
            <Txt tone="strong" weight="medium" size={13}>
              Send {naira(bank.amount)} to this account
            </Txt>
            <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
              Your wallet is credited once we confirm the money has arrived. It is not instant.
            </Txt>

            {/* Named explicitly, NOT iterated: the payload is the shop's raw
                payment-settings block and also contains `enabled: true`, which
                iterating would print as a detail row saying "ENABLED — true". */}
            <View style={{ marginTop: 16, gap: 12 }}>
              {(
                [
                  ["BANK", bank.bank.bank_name],
                  ["ACCOUNT NAME", bank.bank.account_name],
                  ["ACCOUNT NUMBER", bank.bank.account_number],
                ] as const
              )
                .filter(([, v]) => Boolean(v))
                .map(([label, v]) => (
                  <View key={label}>
                    <Text style={s.detailLabel}>{label}</Text>
                    <Txt tone="strong" size={13} selectable style={{ marginTop: 4 }}>
                      {v}
                    </Txt>
                  </View>
                ))}
            </View>
          </Panel>

          <SectionLabel>QUOTE THIS REFERENCE</SectionLabel>
          <Panel>
            <Txt tone="strong" display size={18} selectable style={{ letterSpacing: 1 }}>
              {bank.reference}
            </Txt>
            <Txt tone="body" size={9} style={{ marginTop: 8, lineHeight: 14 }}>
              Without it we cannot match your transfer to your account.
            </Txt>

            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(bank.reference);
                setCopied(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [s.copy, pressed && { opacity: 0.75 }]}
            >
              <Text style={s.copyText}>{copied ? "Copied" : "Copy reference"}</Text>
            </Pressable>
          </Panel>

          <GradientButton
            label="Back to my wallet"
            style={{ marginTop: 20 }}
            onPress={() => {
              // Refresh on the way out so a confirmed transfer shows at once.
              void getWallet();
              router.replace("/wallet");
            }}
          />
        </>
      ) : (
        <>
          <SectionLabel>HOW MUCH</SectionLabel>
          <Panel>
            <Field
              account
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="10000"
              keyboardType="number-pad"
              error={error && !valid ? error : undefined}
            />

            <View style={s.quickRow}>
              {QUICK.map((q) => {
                const on = value === q;

                return (
                  <Pressable
                    key={q}
                    onPress={() => setAmount(String(q))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.quick, on && s.quickOn, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={[s.quickText, on && { color: "#FFFFFF" }]}>
                      {naira(q).replace("₦", "₦ ")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Txt tone="body" size={9} style={{ marginTop: 14 }}>
              Between {naira(TOPUP_MIN)} and {naira(TOPUP_MAX)} per top-up.
            </Txt>
          </Panel>

          <SectionLabel>HOW YOU’LL PAY</SectionLabel>
          <Panel padded={false}>
            {METHODS.filter((m) => !live || live[m.key]?.available !== false).map((m, i) => {
              const on = method === m.key;

              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMethod(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [s.method, pressed && { opacity: 0.75 }]}
                >
                  <View style={[s.radio, on && s.radioOn]}>
                    {on ? <View style={s.radioDot} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt tone="strong" weight="medium" size={11}>
                      {m.label}
                    </Txt>
                    <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                      {m.sub}
                    </Txt>
                  </View>
                  {i < METHODS.length - 1 ? <View style={s.divider} /> : null}
                </Pressable>
              );
            })}
          </Panel>

          {outcome ? (
            <Panel style={{ marginTop: 16 }}>
              <Txt tone="strong" size={12} weight="medium">
                Payment update
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                {outcome}
              </Txt>
            </Panel>
          ) : null}

          {error && valid ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          <Txt tone="body" size={9} style={{ marginTop: 18, lineHeight: 14 }}>
            Store credit is spent in the shop and is not cash. Only money you have EARNED —
            referrals and resale — can be cashed out.
          </Txt>
        </>
      )}
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  quick: {
    paddingHorizontal: 13,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  quickOn: { backgroundColor: t.colors.primary },
  quickText: { fontFamily: fonts.medium, fontSize: 10.5, color: t.textInk.body },

  method: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  divider: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.lineSoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: t.surfaces.lineField,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: t.colors.primaryOn },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary },

  detailLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
  },
  copy: {
    marginTop: 16,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  copyText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: t.surfaces.cart },
});
