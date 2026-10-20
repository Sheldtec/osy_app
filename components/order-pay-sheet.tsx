import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SvgProps } from "react-native-svg";

import { SectionLabel } from "@/components/account-ui";
import { Notice } from "@/components/checkout-ui";
import { IconCard, IconVerified, IconWalletPay } from "@/components/icons";
import { GradientButton, Txt } from "@/components/ui";
import { payOrder, type Order } from "@/lib/account-api";
import { verifyPayment, type PaymentMethodId } from "@/lib/checkout-api";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { grouped, naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import type { Wallet } from "@/lib/types";
import { getWallet } from "@/lib/wallet";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Paying an order that already exists.
 *
 * An order is created BEFORE any money moves and persists as "To pay", but
 * until now there was nothing behind that label: the hosted payment link was
 * handed over once at checkout and never resurfaced, and the bank details
 * arrived once in the checkout response — the confirm screen's own fallback copy
 * was "we don't have the payment details on this device any more". A customer
 * whose card was declined, or who chose a transfer and changed their mind, had
 * an order they could look at and not pay. This sheet is the way back in.
 *
 * Four rules it never breaks:
 *   · No amount is sent. The server re-prices the charge from the order's own
 *     stored total under a row lock, so what this sheet prints is a quotation
 *     of that figure and never the thing committed.
 *   · A wallet payment is done when the call returns. A CARD payment is not:
 *     the browser sheet closing proves nothing, so the server is ASKED what
 *     happened.
 *   · `paid: false` is reported as "not seen yet", never as a failure — a
 *     webhook can land seconds after the customer gets back.
 *   · A method the server would refuse is not offered. While a card payment is
 *     still unconfirmed the gateways are shown and disabled, because a second
 *     session is how one order collects two real charges — and the way out is
 *     to CHECK the first one, which is what the button at the top does.
 *
 * NAIRA, not the display currency. The amount is a Naira figure, the wallet is
 * a Naira ledger, and the two are COMPARED here — "you are ₦42,000 short"
 * cannot be computed in a converted currency without rounding the answer. The
 * converted equivalent sits under the amount, where it informs without being
 * the number anyone commits to.
 */

/**
 * The methods, in the order they are offered.
 *
 * Wallet first: it is instant, and it is the only one that does not hand the
 * customer to a stranger's page. The gateways are named by PROVIDER, because
 * what the customer is choosing is who they will be handed to. The two manual
 * methods are last — they are the slowest to confirm, since a person at the
 * shop has to match the money to the order.
 */
const METHODS: {
  id: PaymentMethodId;
  label: string;
  sub: string;
  glyph?: React.ComponentType<SvgProps>;
  /** True for anything that opens a provider session we then have to wait on. */
  gateway?: boolean;
}[] = [
  { id: "wallet", label: "Wallet credit", sub: "Instant, from your store credit", glyph: IconWalletPay },
  {
    id: "flutterwave",
    label: "Flutterwave",
    sub: "Card or bank transfer · confirmed at once",
    glyph: IconCard,
    gateway: true,
  },
  {
    id: "paystack",
    label: "Paystack",
    sub: "Card, bank or USSD on Paystack’s page",
    glyph: IconCard,
    gateway: true,
  },
  { id: "bank_transfer", label: "Bank transfer", sub: "We show the account details and your reference" },
  { id: "crypto", label: "Crypto", sub: "USDT or Bitcoin" },
];

export function OrderPaySheet({
  order,
  open,
  onClose,
  onDone,
  bottomInset,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  /**
   * What actually happened, in words the screen can print as-is, plus the fresh
   * order row when the server handed one back.
   */
  onDone: (message: string, order?: Order) => void;
  bottomInset: number;
}) {
  const s = useThemedStyles(makeS);
  const theme = useTheme();
  const money = useApproxMoney();
  const { code: currency } = useCurrency();

  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The balance this would spend.
   *
   * null when it could not be read, and the row then says so rather than
   * printing a zero — an invented balance is the one thing a money screen must
   * never show (see `getWallet`, which returns null for exactly this reason).
   */
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const invoice = order?.invoice ?? null;
  const amount = invoice?.amount_due ?? 0;
  /**
   * The method the order is on now, so switching away from it can be called
   * what it is. Read once per open rather than from `method`, which the
   * customer is about to change.
   */
  const current = invoice?.method ?? null;

  useEffect(() => {
    if (!open) return;

    setError(null);
    setBusy(false);
    setChecking(false);
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
  const awaiting = invoice?.awaiting ?? false;

  /** Only the methods the shop can actually take, in the order above. */
  const rows = METHODS.filter((m) => invoice?.methods?.[m.id] !== false).map((m) => ({
    ...m,
    // A row that can only fail is shown, not offered: the customer needs to see
    // the balance and the gap, or why the card is on hold, but tapping it would
    // spend their trust for nothing.
    disabled:
      (m.id === "wallet" && wallet !== null && shortfall > 0)
      || (m.gateway === true && awaiting),
    reason:
      m.id === "wallet" && wallet === null
        ? "We couldn’t read your balance just now"
        : m.id === "wallet" && shortfall > 0
          ? `Balance ${naira(wallet?.balance ?? 0)} · ${naira(shortfall)} short`
          : m.id === "wallet"
            ? `Balance ${naira(wallet?.balance ?? 0)}`
            : m.gateway === true && awaiting
              ? "On hold until your last card payment is confirmed"
              : m.sub,
  }));

  /**
   * Pre-select the method the order is already on, when it is still usable —
   * most customers are coming back to finish what they chose, not to change it.
   * Otherwise the first method that would actually work.
   */
  const firstUsable = rows.find((r) => !r.disabled)?.id;
  useEffect(() => {
    if (!open) return;
    setMethod((chosen) => {
      if (chosen && rows.some((r) => r.id === chosen && !r.disabled)) return chosen;
      const onCurrent = rows.find((r) => r.id === current && !r.disabled);

      return onCurrent?.id ?? firstUsable ?? null;
    });
    // `rows` is rebuilt every render, so this effect runs on every one. That is
    // safe only because the updater returns the SAME value when the current
    // choice is still usable, and React bails out of a no-op setState — so it
    // settles after at most one extra render rather than looping.
  }, [open, current, firstUsable, awaiting, wallet, rows]);

  /**
   * Changing away from a manual method is the one choice that can go wrong
   * outside the app: the money may already be on its way under a narration the
   * shop is watching for, and nothing here can see a transfer in flight at a
   * bank. So it is said out loud rather than guarded against.
   */
  const leavingManual =
    (current === "bank_transfer" || current === "crypto") && method !== null && method !== current;

  async function pay() {
    if (!order || !method || busy) return;

    setBusy(true);
    setError(null);

    try {
      const started = await payOrder(order.id, method);

      if (method === "wallet") {
        onDone(
          started.wallet_balance !== undefined
            ? `Paid from your wallet. Your balance is now ${naira(started.wallet_balance)}.`
            : `Paid. ${order.ref} is confirmed.`,
          started.order,
        );

        return;
      }

      if (method === "bank_transfer" || method === "crypto") {
        // Nothing is charged and nothing is pending: the order is now waiting
        // for money the customer sends themselves. The details are on the order
        // screen, which `started.order` refreshes.
        onDone(
          method === "bank_transfer"
            ? "Transfer the amount to the account on this order and quote the reference — we’ll confirm it as soon as it lands."
            : "Send the amount to the wallet address on this order and quote the reference — we’ll confirm it as soon as it lands.",
          started.order,
        );

        return;
      }

      if (!started.payment_url || !started.tx_ref) {
        setError("The payment provider didn’t return a checkout link. Please try again.");

        return;
      }

      // openAuthSessionAsync, not openBrowserAsync: it is the only installed
      // API that closes the sheet on BOTH platforms when the provider redirects
      // back to us. It resolves on dismissal whether the customer paid, failed
      // or swiped it away — which is why the server is asked next.
      await WebBrowser.openAuthSessionAsync(
        started.payment_url,
        Linking.createURL(`/account/order/${order.id}`),
      );

      onDone(await describe(started.tx_ref, order.ref), undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t take that payment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Ask the server about a payment we never got an answer on. */
  async function check() {
    if (!invoice?.check_ref || checking) return;

    setChecking(true);
    setError(null);
    try {
      onDone(await describe(invoice.check_ref, order?.ref ?? ""), undefined);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We couldn’t check that payment just now.",
      );
    } finally {
      setChecking(false);
    }
  }

  if (!order || !invoice) return null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={s.scrim}
        onPress={busy ? undefined : onClose}
        accessibilityLabel="Close payment"
      />

      <View style={[s.sheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}>
        <View style={s.handle} />

        <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
          {/* ---- what is being paid ---- */}
          <Text style={s.amountLabel}>DUE ON {order.ref}</Text>
          <View style={s.amountRow}>
            <Text style={s.amountSign}>₦</Text>
            <Text style={s.amount}>{grouped(amount)}</Text>
          </View>
          {currency !== "NGN" ? (
            <Txt tone="faint" size={10.5} style={{ marginTop: 8 }}>
              {money(amount)} at today’s rate · charged in ₦
            </Txt>
          ) : null}

          {/* ---- a payment we are still waiting on ----
              Before the method list, because while this is true the answer is
              almost never "pay again". */}
          {awaiting && invoice.check_ref ? (
            <View style={{ marginTop: 16 }}>
              <Notice tone="info">
                A card payment on this order hasn’t been confirmed yet. Check it before paying
                again — if it went through, paying now would charge you twice.
              </Notice>
              <Pressable
                onPress={() => void check()}
                accessibilityRole="button"
                disabled={checking}
                style={({ pressed }) => [s.check, pressed && { opacity: 0.75 }]}
              >
                <Text style={s.checkText}>
                  {checking ? "Checking…" : "Check that payment"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ---- how ---- */}
          <SectionLabel>HOW YOU’LL PAY</SectionLabel>

          <View style={s.methods}>
            {rows.map((row) => (
              <MethodRow
                key={row.id}
                on={method === row.id}
                disabled={row.disabled}
                label={row.label}
                sub={row.reason}
                current={row.id === current}
                glyph={row.glyph}
                onPress={() => setMethod(row.id)}
              />
            ))}
          </View>

          {method === "wallet" && shortfall > 0 ? (
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

          {leavingManual ? (
            <View style={{ marginTop: 14 }}>
              <Notice tone="info">
                If you’ve already sent that transfer, don’t change the method — get in touch and
                we’ll match it to this order instead.
              </Notice>
            </View>
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
              "We only mark an order paid once the payment is verified.",
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
              : method === "bank_transfer" || method === "crypto"
                ? "Show me the details"
                : `Pay ${naira(amount)}`
          }
          disabled={busy || method === null}
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
 * What the server says happened to one payment reference, in a sentence.
 *
 * The `kind` guard matters: one reference space covers orders, wallet top-ups
 * and instalment attempts, and another payable's reference must never be read
 * as this order's.
 *
 * Three outcomes, and conflating any two of them is a customer misled:
 *   · paid — the money is in;
 *   · unapplied — the money is in, but the order had already been settled
 *     another way, so it is a second charge the shop is holding and a person
 *     will put right. Said plainly, because the alternative is a customer who
 *     believes it vanished;
 *   · anything else — NOT SEEN YET, which is not a decline. A webhook can land
 *     a minute later.
 */
async function describe(txRef: string, ref: string): Promise<string> {
  const status = await verifyPayment(txRef);

  if (status.kind !== "order") {
    return "That reference belongs to a different payment. Pull down to refresh this order.";
  }

  if (status.attempt_status === "unapplied") {
    return "That payment went through, but this order had already been paid. We’ve recorded it and the team will be in touch to put it right.";
  }

  if (status.paid) {
    return `Paid ${naira(status.total)}. ${ref || "Your order"} is confirmed and we’re on it.`;
  }

  return "We haven’t seen that payment yet. If you completed it, give it a moment and pull down to refresh.";
}

/**
 * One payment method.
 *
 * `disabled` is a real state here rather than a styling flourish: a wallet that
 * cannot cover the amount, or a gateway held back while an earlier card payment
 * is unconfirmed, is SHOWN — the customer needs to see the balance and the gap,
 * or why the card is on hold — but it is not selectable, because a button that
 * can only fail spends the customer's trust for nothing.
 */
function MethodRow({
  on,
  disabled = false,
  current = false,
  label,
  sub,
  glyph: Glyph,
  onPress,
}: {
  on: boolean;
  disabled?: boolean;
  /** The method the order is on now, so "keeping it" reads differently from "changing to it". */
  current?: boolean;
  label: string;
  sub: string;
  glyph?: React.ComponentType<SvgProps>;
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
        {Glyph ? (
          <Glyph width={18} height={18} color={on ? theme.colors.primaryOn : theme.textInk.soft} />
        ) : (
          // No exported glyph for the manual methods — the checkout screen
          // leaves them iconless too. The initial keeps the row's rhythm.
          <Txt tone={on ? "primary" : "body"} weight="medium" size={13}>
            {label.charAt(0)}
          </Txt>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Txt tone={disabled ? "body" : "strong"} weight="medium" size={13}>
            {label}
          </Txt>
          {current ? <Text style={s.currentTag}>CHOSEN</Text> : null}
        </View>
        <Txt tone={disabled ? "danger" : "body"} size={10.5} style={{ marginTop: 3, lineHeight: 15 }}>
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

  check: {
    marginTop: 12,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  methods: { borderRadius: 18, backgroundColor: t.surfaces.cart, overflow: "hidden" },
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
  // The method already on the order, so "finish what I chose" is one tap and
  // visibly different from switching.
  currentTag: {
    fontFamily: fonts.medium,
    fontSize: 8,
    letterSpacing: 1,
    color: t.colors.primaryOn,
    includeFontPadding: false,
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
