import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SvgProps } from "react-native-svg";

import { SectionLabel } from "@/components/account-ui";
import { IconCard, IconVerified, IconWalletPay } from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { getPaymentMethods, type PaymentMethods } from "@/lib/checkout-api";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { grouped, naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import {
  payQuote,
  verifyQuotePayment,
  type QuotePayMethod,
  type SpecialOrder,
} from "@/lib/special-orders-api";
import type { Wallet } from "@/lib/types";
import { getWallet } from "@/lib/wallet";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Paying a special-order quote.
 *
 * The sheet exists because accepting a quote used to be a single button that
 * debited the wallet, so a customer quoted ₦250,000 with ₦40,000 of store
 * credit had no way to accept at all. Choosing a method is the whole feature,
 * which is why it gets a surface of its own rather than a second button in a
 * list row.
 *
 * Three rules it never breaks:
 *   · No amount is sent. The server charges the `quote_amount` on its own
 *     locked row, so what this sheet prints is a quotation of that figure and
 *     never the thing committed.
 *   · A wallet payment is done when the call returns. A CARD payment is not:
 *     the sheet closing proves nothing, so the server is ASKED what happened.
 *   · `paid: false` is reported as "not seen yet", never as a failure — a
 *     webhook can still land seconds after the customer gets back.
 *
 * NAIRA, not the display currency. The quote is a Naira figure, the wallet is a
 * Naira ledger, and the two are COMPARED here — "you are ₦42,000 short" cannot
 * be computed in a converted currency without rounding the answer. The
 * converted equivalent sits under the amount, where it informs without being
 * the number anyone commits to.
 */

/** The provider is the label, not what it accepts: the customer is choosing who to be handed to. */
const GATEWAYS: { key: Exclude<QuotePayMethod, "wallet">; label: string; sub: string }[] = [
  { key: "flutterwave", label: "Flutterwave", sub: "Card or bank transfer · confirmed at once" },
  { key: "paystack", label: "Paystack", sub: "Card or bank transfer · confirmed at once" },
];

export function QuotePaySheet({
  order,
  open,
  onClose,
  onDone,
  bottomInset,
}: {
  order: SpecialOrder | null;
  open: boolean;
  onClose: () => void;
  /**
   * What actually happened, in words the screen can print as-is, plus the
   * fresh row when the server handed one back.
   */
  onDone: (message: string, order?: SpecialOrder) => void;
  bottomInset: number;
}) {
  const s = useThemedStyles(makeS);
  const theme = useTheme();
  const money = useApproxMoney();
  const { code: currency } = useCurrency();

  const [method, setMethod] = useState<QuotePayMethod>("wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which methods the shop can actually take right now. */
  const [live, setLive] = useState<PaymentMethods | null>(null);
  /**
   * The balance this would spend.
   *
   * null when it could not be read, and the row then says so rather than
   * printing a zero — an invented balance is the one thing a money screen must
   * never show (see `getWallet`, which returns null for exactly this reason).
   */
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const amount = order?.quote_amount ?? 0;

  useEffect(() => {
    if (!open) return;

    setError(null);
    setBusy(false);

    getPaymentMethods()
      // Not fatal: without it every gateway is offered and an unavailable one
      // is refused by the server with its own message.
      .then(setLive)
      .catch(() => setLive(null));

    getWallet().then(setWallet);
  }, [open]);

  // Android's custom tab needs warming; both calls are Android-only and THROW
  // on web, so they are guarded rather than fired blind.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();

    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const shortfall = wallet ? Math.max(0, amount - wallet.balance) : 0;
  /** A wallet that demonstrably cannot cover it is not offered — it would only fail. */
  const walletUsable = wallet === null || shortfall === 0;
  const gateways = GATEWAYS.filter((g) => !live || live[g.key]?.available !== false);
  const canPay = !busy && (method === "wallet" ? walletUsable : true);

  /**
   * The wallet is pre-selected only while it can actually pay.
   *
   * Keyed on the first gateway's KEY rather than the array, which is rebuilt
   * every render and would re-run this on each one.
   */
  const firstGateway = gateways[0]?.key;
  useEffect(() => {
    if (method === "wallet" && !walletUsable && firstGateway) {
      setMethod(firstGateway);
    }
  }, [method, walletUsable, firstGateway]);

  async function pay() {
    if (!order || busy) return;

    setBusy(true);
    setError(null);

    try {
      const started = await payQuote(order.id, method);

      if (method === "wallet") {
        onDone(
          started.replayed
            ? `That payment had already gone through — ${order.ref} is paid.`
            : started.wallet_balance !== undefined
              ? `Paid from your wallet. Your balance is now ${naira(started.wallet_balance)}.`
              : `Paid. ${order.ref} is confirmed.`,
          started.special_order,
        );

        return;
      }

      if (!started.payment_url || !started.tx_ref) {
        setError("The payment provider didn’t return a checkout link. Please try again.");

        return;
      }

      // openAuthSessionAsync, not openBrowserAsync: it is the only installed
      // API that closes the sheet on BOTH platforms when the provider
      // redirects back to us.
      await WebBrowser.openAuthSessionAsync(
        started.payment_url,
        Linking.createURL("/account/special-orders"),
      );

      const status = await verifyQuotePayment(started.tx_ref);

      if (status.paid) {
        onDone(`Paid ${naira(status.total)}. ${order.ref} is confirmed and we’re on it.`);

        return;
      }

      if (status.attempt_status === "unapplied") {
        // Real money, against a request that had already closed. Said plainly,
        // because the customer must not be left thinking it vanished — and not
        // dressed up as success, because the request is not confirmed.
        onDone(
          "That payment went through, but this request had already closed. We’ve recorded it and the team will be in touch to put it right.",
        );

        return;
      }

      onDone(
        "We haven’t seen that payment yet. If you completed it, give it a moment and pull down to refresh.",
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn’t take that payment. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!order) return null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={busy ? undefined : onClose} accessibilityLabel="Close payment" />

      <View style={[s.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
        <View style={s.handle} />

        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
          {/* ---- what is being paid ---- */}
          <Text style={s.amountLabel}>THE QUOTE FOR {order.ref}</Text>
          <View style={s.amountRow}>
            <Text style={s.amountSign}>₦</Text>
            <Text style={s.amount}>{grouped(amount)}</Text>
          </View>
          <Txt tone="body" size={11} style={{ marginTop: 6, lineHeight: 17 }}>
            {order.title}
          </Txt>
          {currency !== "NGN" ? (
            <Txt tone="faint" size={10.5} style={{ marginTop: 8 }}>
              {money(amount)} at today’s rate · charged in ₦
            </Txt>
          ) : null}

          {/* ---- how ---- */}
          <SectionLabel>HOW YOU’LL PAY</SectionLabel>

          <View style={s.methods}>
            {/* Wallet first: it is instant, and it is the only one that does not
                hand the customer to a stranger's page. */}
            <MethodRow
              on={method === "wallet"}
              disabled={!walletUsable}
              label="Wallet credit"
              sub={
                wallet === null
                  ? "We couldn’t read your balance just now"
                  : shortfall > 0
                    ? `Balance ${naira(wallet.balance)} · ${naira(shortfall)} short`
                    : `Balance ${naira(wallet.balance)}`
              }
              glyph={IconWalletPay}
              onPress={() => setMethod("wallet")}
            />

            {gateways.map((g) => (
              <MethodRow
                key={g.key}
                on={method === g.key}
                label={g.label}
                sub={g.sub}
                glyph={IconCard}
                onPress={() => setMethod(g.key)}
              />
            ))}
          </View>

          {shortfall > 0 ? (
            <Pressable
              onPress={() => {
                onClose();
                router.push("/account/wallet-topup");
              }}
              accessibilityRole="link"
              style={({ pressed }) => [s.topup, pressed && { opacity: 0.75 }]}
            >
              <Text style={s.topupText}>Add {naira(shortfall)} to my wallet instead</Text>
            </Pressable>
          ) : null}

          {error ? (
            <Txt tone="danger" size={11} style={{ marginTop: 14, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          <View style={s.notes}>
            {[
              "Your card details go to the provider, never to us.",
              "Nothing is charged until you confirm it on their page.",
              "We only mark a quote paid once the payment is verified with the provider.",
            ].map((line) => (
              <View key={line} style={s.note}>
                <IconVerified width={13} height={13} color={theme.colors.gold2} />
                <Txt tone="body" size={10.5} style={{ flex: 1, lineHeight: 16 }}>
                  {line}
                </Txt>
              </View>
            ))}
          </View>
        </ScrollView>

        <GradientButton
          label={
            busy
              ? method === "wallet"
                ? "Paying…"
                : "Opening…"
              : `Pay ${naira(amount)}`
          }
          disabled={!canPay}
          style={{ marginTop: 16 }}
          onPress={() => void pay()}
        />

        <Pressable
          onPress={busy ? undefined : onClose}
          accessibilityRole="button"
          disabled={busy}
          style={{ alignItems: "center", paddingVertical: 12 }}
        >
          <Text style={s.close}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * One payment method.
 *
 * `disabled` is a real state here rather than a styling flourish: a wallet that
 * cannot cover the quote is shown — the customer needs to see the balance and
 * the gap — but it is not selectable, because a button that can only fail
 * spends the customer's trust for nothing.
 */
function MethodRow({
  on,
  disabled = false,
  label,
  sub,
  glyph: Glyph,
  onPress,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  sub: string;
  glyph: React.ComponentType<SvgProps>;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeS);
  const theme = useTheme();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [s.method, pressed && !disabled && { opacity: 0.75 }]}
    >
      <View style={[s.glyph, on && s.glyphOn]}>
        <Glyph
          width={18}
          height={18}
          color={on ? theme.colors.primaryOn : theme.textInk.soft}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Txt tone={disabled ? "body" : "strong"} weight="medium" size={13}>
          {label}
        </Txt>
        <Txt tone={disabled ? "danger" : "body"} size={10.5} style={{ marginTop: 3 }}>
          {sub}
        </Txt>
      </View>
      <View style={[s.radio, on && s.radioOn, disabled && s.radioOff]}>
        {on ? <View style={s.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(20,12,26,0.34)" },
  sheet: {
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaces.handle,
    alignSelf: "center",
    marginBottom: 16,
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
    fontSize: 24,
    color: t.colors.primaryOn,
    marginRight: 6,
    // Sits on the figures' baseline rather than the box's, so the glyph does
    // not float above a 38px numeral.
    paddingBottom: 4,
    includeFontPadding: false,
  },
  amount: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 46,
    color: t.textInk.strong,
    includeFontPadding: false,
  },

  methods: {
    borderRadius: 18,
    backgroundColor: t.surfaces.cart,
    overflow: "hidden",
  },
  method: { flexDirection: "row", alignItems: "center", gap: 14, padding: 15 },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphOn: { backgroundColor: t.colors.primaryCont },
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
  radioOff: { borderColor: t.surfaces.lineSoft },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary },

  topup: {
    marginTop: 12,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  topupText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  notes: { marginTop: 18, gap: 9 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 9 },

  close: { fontFamily: fonts.medium, fontSize: 11.5, color: t.textInk.body },
});
