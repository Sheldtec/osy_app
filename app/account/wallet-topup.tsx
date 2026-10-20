import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountShell, Empty, Panel, SectionLabel } from "@/components/account-ui";
import { IconBank, IconPayment, IconVerified } from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { grouped, naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { getPaymentMethods, type PaymentMethods } from "@/lib/checkout-api";
import type { Wallet } from "@/lib/types";
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
import { useTheme, useThemedStyles } from "@/theme/theme-context";
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
 *
 * The AMOUNT is the screen's subject, so it is typed into a display-scale well
 * rather than a form field in a list of form fields — this is the one number
 * the customer came here to decide, and a 13px input in a stack of panels does
 * not say so. Everything else on the screen is subordinate to it: the balance
 * it moves, the shortcut chips that fill it, and the method that collects it.
 */

/** Amounts people actually top up with, so most never type anything. */
const QUICK = [5_000, 10_000, 25_000, 50_000, 100_000];

/**
 * How the money can arrive.
 *
 * The PROVIDER is the label, not what it accepts. Two rows both reading "Card
 * or transfer" with the provider demoted to the subtitle is a choice between
 * two things with the same name — the customer is actually picking which
 * processor to be handed to, so that is what the row is named after.
 */
const METHODS: { key: TopupMethod; label: string; sub: string; bank?: true }[] = [
  { key: "flutterwave", label: "Flutterwave", sub: "Card or transfer · credited instantly" },
  { key: "paystack", label: "Paystack", sub: "Card or transfer · credited instantly" },
  { key: "bank_transfer", label: "Bank transfer", sub: "Credited once we confirm it", bank: true },
];

/** The largest top-up is 2,000,000 — seven digits, and no more. */
const MAX_DIGITS = String(TOPUP_MAX).length;

export default function WalletTopupScreen() {
  const s = useThemedStyles(makeS);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();
  const money = useApproxMoney();
  const { code: currency } = useCurrency();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<TopupMethod>("flutterwave");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Set once a bank transfer has been started — the details to quote. */
  const [bank, setBank] = useState<BankInstructions | null>(null);
  /** Set after a gateway round trip, so the outcome is stated rather than guessed. */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Which methods the shop can actually take right now. */
  const [live, setLive] = useState<PaymentMethods | null>(null);
  /**
   * The balance this top-up is moving.
   *
   * null when it could not be read, and the strip is then hidden rather than
   * showing a zero: an invented balance is the one thing a money screen must
   * never print (see `getWallet`, which returns null for the same reason).
   */
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const field = useRef<TextInput>(null);

  useEffect(() => {
    getPaymentMethods()
      .then(setLive)
      // Not fatal: without it every method is offered and an unavailable one
      // is refused by the server with its own message.
      .catch(() => setLive(null));

    getWallet().then(setWallet);
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

  const digits = amount.replace(/[^\d]/g, "");
  const value = Math.round(Number(digits) || 0);
  const valid = value >= TOPUP_MIN && value <= TOPUP_MAX;
  /**
   * What the well shows while it is being typed into.
   *
   * Grouped, because a seven-digit amount with no separators is unreadable and
   * this is the figure someone is about to commit money to. Grouping the DIGIT
   * STRING rather than `value` keeps a lone "0" visible — deriving it from the
   * number would blank the well the moment the first zero was typed.
   */
  const shown = digits ? grouped(Number(digits)) : "";

  /** A transfer already waiting on us — quoted so nobody sends a second one. */
  const pending = (wallet?.pending_topups ?? []).filter((p) => p.status === "pending");

  const settle = useCallback(async (reference: string) => {
    try {
      const status = await verifyTopup(reference);
      if (status.paid) {
        setOutcome(`${money(status.total)} is in your wallet.`);
        // The strip above must not keep quoting the old balance.
        void getWallet().then(setWallet);

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
  }, [money]);

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

  function copy(text: string, what: string) {
    void Clipboard.setStringAsync(text);
    setCopied(what);
  }

  if (!signedIn) {
    return (
      <AccountShell title="Add money" subtitle="Top up the store credit on your account.">
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
      title="Add money"
      subtitle="Top up your store credit and spend it on any order."
      footerSpace={bank ? 40 : 130}
      footer={
        bank ? null : (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
            {/*
 * NAIRA ON THE BUTTON — the documented exception to "pay controls carry the
 * display currency" (owner direction, 2026-10-19).
 *
 * Everywhere else a pay amount is a PRICE the shop set, and converting it is
 * the whole point. Here it is a figure the customer typed themselves, into a
 * well that can only accept Naira, so a button reading "Add ≈ $6.11" over an
 * input reading 10,000 asks them to confirm a number they never entered. The
 * converted equivalent is shown under the well instead, where it informs
 * without being the thing committed to.
 */}
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
          <View style={s.transferHead}>
            <Text style={s.amountLabel}>SEND EXACTLY</Text>
            <View style={s.amountRow}>
              <Text style={[s.amountSign, s.amountSignOn]}>₦</Text>
              <Text style={s.amountStatic}>{grouped(bank.amount)}</Text>
            </View>
            <Txt tone="body" size={11} style={{ marginTop: 12, lineHeight: 17 }}>
              Your wallet is credited once we confirm the money has arrived. It is not instant.
            </Txt>
          </View>

          <SectionLabel>TRANSFER TO</SectionLabel>
          <Panel padded={false}>
            {/* Named explicitly, NOT iterated: the payload is the shop's raw
                payment-settings block and also contains `enabled: true`, which
                iterating would print as a detail row saying "ENABLED — true". */}
            {(
              [
                ["BANK", bank.bank.bank_name, false],
                ["ACCOUNT NAME", bank.bank.account_name, false],
                ["ACCOUNT NUMBER", bank.bank.account_number, true],
              ] as const
            )
              .filter(([, v]) => Boolean(v))
              .map(([label, v, copyable], i, rows) => (
                <View key={label} style={s.detailRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailLabel}>{label}</Text>
                    <Txt tone="strong" size={14} weight="medium" selectable style={{ marginTop: 5 }}>
                      {v}
                    </Txt>
                  </View>
                  {copyable ? (
                    <Pressable
                      onPress={() => copy(String(v), label)}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy ${label.toLowerCase()}`}
                      hitSlop={8}
                      style={({ pressed }) => [s.copySmall, pressed && { opacity: 0.75 }]}
                    >
                      <Text style={s.copySmallText}>{copied === label ? "Copied" : "Copy"}</Text>
                    </Pressable>
                  ) : null}
                  {i < rows.length - 1 ? <View style={s.divider} /> : null}
                </View>
              ))}
          </Panel>

          <SectionLabel>QUOTE THIS REFERENCE</SectionLabel>
          <Panel>
            <View style={s.refWell}>
              <Txt tone="strong" display size={20} selectable style={{ letterSpacing: 2 }}>
                {bank.reference}
              </Txt>
            </View>
            <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
              Without it we cannot match your transfer to your account.
            </Txt>

            <Pressable
              onPress={() => copy(bank.reference, "reference")}
              accessibilityRole="button"
              style={({ pressed }) => [s.copy, pressed && { opacity: 0.75 }]}
            >
              <Text style={s.copyText}>
                {copied === "reference" ? "Copied" : "Copy reference"}
              </Text>
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
          {/* ---- the amount, as the subject of the screen ---- */}
          <View style={s.amountCard}>
            <Text style={s.amountLabel}>AMOUNT TO ADD</Text>

            {/* The whole well is the touch target, not just the glyphs in it. */}
            <Pressable
              onPress={() => field.current?.focus()}
              accessibilityRole="button"
              accessibilityLabel="Edit the amount"
              style={s.amountRow}
            >
              <Text style={[s.amountSign, value > 0 && s.amountSignOn]}>₦</Text>
              <TextInput
                ref={field}
                value={shown}
                onChangeText={(t) => setAmount(t.replace(/[^\d]/g, "").slice(0, MAX_DIGITS))}
                placeholder="0"
                placeholderTextColor={theme.textInk.faint}
                keyboardType="number-pad"
                returnKeyType="done"
                selectionColor={theme.colors.primaryOn}
                accessibilityLabel="Amount in Naira"
                style={s.amountInput}
              />
            </Pressable>

            <View style={s.amountRule} />

            {/*
 * The amount FIELD stays in Naira and so do its bounds: the server checks the
 * typed number against its own minimum and ceiling, and an approximate figure
 * cannot be posted. That leaves a Naira input on a screen where everything
 * else converted, so this line says what the typed amount is worth — without
 * ever becoming the number that gets sent.
 */}
            {error && !valid ? (
              <Txt tone="danger" size={11} style={{ lineHeight: 16 }}>
                {error}
              </Txt>
            ) : currency !== "NGN" && value > 0 ? (
              <Txt tone="faint" size={11}>
                {money(value)} at today’s rate
              </Txt>
            ) : (
              <Txt tone="faint" size={11}>
                {naira(TOPUP_MIN)} – {naira(TOPUP_MAX)} per top-up
              </Txt>
            )}

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
                    <Text style={[s.quickText, on && s.quickTextOn]}>{naira(q)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ---- what this moves ---- */}
          {wallet ? (
            <View style={s.strip}>
              <View style={{ flex: 1 }}>
                <Text style={s.stripLabel}>BALANCE NOW</Text>
                <Txt tone="strong" size={14} weight="medium" style={{ marginTop: 4 }}>
                  {money(wallet.balance)}
                </Txt>
              </View>
              {value > 0 ? (
                <>
                  <Text style={s.stripArrow}>→</Text>
                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    <Text style={s.stripLabel}>AFTER THIS TOP-UP</Text>
                    <Text style={s.stripAfter}>{money(wallet.balance + value)}</Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {/* A transfer already in flight. Shown before the method list, so it
              is read BEFORE a second one is started for the same money. */}
          {pending.length ? (
            <Panel style={s.pending}>
              <Text style={s.pendingLabel}>AWAITING CONFIRMATION</Text>
              {pending.slice(0, 2).map((p) => (
                <Txt key={p.id} tone="strong" size={12} style={{ marginTop: 8, lineHeight: 18 }}>
                  {money(p.amount)} · quote {p.reference}
                </Txt>
              ))}
              <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
                If you have already sent this, there is no need to start it again.
              </Txt>
            </Panel>
          ) : null}

          <SectionLabel>HOW YOU’LL PAY</SectionLabel>
          <Panel padded={false}>
            {METHODS.filter((m) => !live || live[m.key]?.available !== false).map((m, i, rows) => {
              const on = method === m.key;
              const Glyph = m.bank ? IconBank : IconPayment;

              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMethod(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [s.method, pressed && { opacity: 0.75 }]}
                >
                  <View style={[s.glyph, on && s.glyphOn]}>
                    <Glyph
                      width={18}
                      height={18}
                      color={on ? theme.colors.primaryOn : theme.textInk.soft}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt tone="strong" weight="medium" size={13}>
                      {m.label}
                    </Txt>
                    <Txt tone="body" size={10.5} style={{ marginTop: 3 }}>
                      {m.sub}
                    </Txt>
                  </View>
                  <View style={[s.radio, on && s.radioOn]}>
                    {on ? <View style={s.radioDot} /> : null}
                  </View>
                  {i < rows.length - 1 ? <View style={s.divider} /> : null}
                </Pressable>
              );
            })}
          </Panel>

          {outcome ? (
            <Panel style={{ marginTop: 16 }}>
              <Txt tone="strong" size={13} weight="medium">
                Payment update
              </Txt>
              <Txt tone="body" size={11} style={{ marginTop: 6, lineHeight: 17 }}>
                {outcome}
              </Txt>
            </Panel>
          ) : null}

          {/* `valid` guards it: an out-of-range message belongs under the well
              it is about, and is already shown there. */}
          {error && valid ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          <View style={s.notes}>
            {[
              "Your card details go to the provider, never to us.",
              "Store credit is spent in the shop and is not cash.",
              "Only money you have EARNED — referrals and resale — can be cashed out.",
            ].map((line) => (
              <View key={line} style={s.note}>
                <IconVerified width={13} height={13} color={theme.colors.gold2} />
                <Txt tone="body" size={10.5} style={{ flex: 1, lineHeight: 16 }}>
                  {line}
                </Txt>
              </View>
            ))}
          </View>
        </>
      )}
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  // ---- the amount well ----
  amountCard: {
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    padding: 18,
    paddingTop: 16,
  },
  amountLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  amountRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 10 },
  amountSign: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: t.textInk.faint,
    marginRight: 6,
    // Sits on the figures' baseline rather than the box's, so the glyph does
    // not float above a 40px numeral.
    paddingBottom: 4,
    includeFontPadding: false,
  },
  amountSignOn: { color: t.colors.primaryOn },
  amountInput: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    color: t.textInk.strong,
    padding: 0,
    includeFontPadding: false,
  },
  /** The static twin of the input, for the transfer we are already waiting on. */
  amountStatic: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  amountRule: { height: 1, backgroundColor: t.surfaces.lineSoft, marginTop: 6, marginBottom: 12 },

  transferHead: { paddingHorizontal: 2, paddingBottom: 22 },

  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  quick: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  quickOn: { backgroundColor: t.colors.primary },
  quickText: { fontFamily: fonts.medium, fontSize: 11.5, color: t.textInk.body },
  quickTextOn: { color: "#FFFFFF" },

  // ---- what the top-up moves ----
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: t.surfaces.actionTint,
  },
  stripLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.1,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  stripArrow: { fontFamily: fonts.medium, fontSize: 15, color: t.textInk.faint },
  stripAfter: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: t.colors.primaryOn,
    marginTop: 4,
    includeFontPadding: false,
  },

  pending: { marginTop: 16, backgroundColor: t.surfaces.noteTint },
  pendingLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.colors.gold2,
    includeFontPadding: false,
  },

  // ---- method rows ----
  method: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphOn: { backgroundColor: t.colors.primaryCont },
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

  // ---- bank details ----
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  detailLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  refWell: {
    backgroundColor: t.surfaces.stepperTrack,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  copy: {
    marginTop: 16,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  copyText: { fontFamily: fonts.medium, fontSize: 12.5, color: t.colors.primaryOn },
  copySmall: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  copySmallText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  notes: { marginTop: 20, gap: 9 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 9 },

  footer: { paddingHorizontal: 20, paddingTop: 14, backgroundColor: t.surfaces.cart },
});
