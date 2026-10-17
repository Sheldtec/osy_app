import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Divider, Notice, SectionCard, SummaryRow } from "@/components/checkout-ui";
import { CheckoutShell } from "@/components/checkout-shell";
import { GradientButton, Overline, Txt } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { useCheckout } from "@/lib/checkout";
import {
  CheckoutError,
  simulatePayment,
  verifyPayment,
  type BankInstructions,
  type CryptoInstructions,
  type PaymentStatus,
} from "@/lib/checkout-api";
import { useApproxMoney } from "@/lib/currency-context";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/theme-context";
import { layout } from "@/theme/tokens";

/**
 * Checkout, step 3 — did the money arrive?
 *
 * This screen exists because the old checkout did not have one. It opened the
 * hosted page, took the sheet closing as success, showed "ORDER PLACED" and
 * emptied the bag — for a declined card, a swiped-away sheet and a completed
 * payment alike.
 *
 * The only source of truth is GET /payments/verify, which actually calls the
 * gateway with the shop's secret key. Three rules follow from that:
 *
 *   · `paid: false` means "not confirmed yet", never "declined". A
 *     signature-verified webhook can land seconds after the redirect, and bank
 *     transfer and crypto stay pending until a person records receipt. So we
 *     re-check on a backing-off schedule before saying anything final.
 *   · the bag is cleared ONLY on `paid`, so an abandoned attempt leaves the
 *     shopper's cart intact and they can retry without rebuilding it.
 *   · one reference space covers orders, wallet top-ups and instalments, so
 *     `kind` is asserted before any order copy is rendered.
 */

/** Backing off rather than hammering: /payments/verify allows 30 a minute. */
const RETRY_MS = [2000, 3000, 5000, 10_000];

export default function ConfirmStep() {
  const theme = useTheme();
  const money = useApproxMoney();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { pending, setPending, reset, ready } = useCheckout();
  const params = useLocalSearchParams<{ tx?: string }>();

  /**
   * The reference, latched the first time we see one.
   *
   * Deriving it every render from `pending` was a bug with teeth: the paid
   * branch calls setPending(null), so on the very next render the reference
   * vanished and the `!txRef` guard below — which sits above the success
   * render — told a shopper whose money had just been taken that there was
   * "nothing to confirm". Latching also survives the draft hydrating a tick
   * late, which otherwise flashed the same screen.
   */
  const latched = useRef<string | null>(null);
  if (latched.current === null) {
    const candidate = params.tx ?? (ready ? (pending?.txRef ?? null) : null);
    if (candidate) latched.current = candidate;
  }
  const txRef = latched.current;

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleared = useRef(false);
  const alive = useRef(true);

  const manualMethod =
    status?.payment_method === "bank_transfer" || status?.payment_method === "crypto";

  const check = useCallback(
    async (ref: string) => {
      setChecking(true);
      setError(null);
      try {
        const res = await verifyPayment(ref);
        if (!alive.current) return;
        setStatus(res);

        // Assert the reference is OURS before touching anything. The checks
        // below empty the bag and destroy the pending record, and one
        // reference space covers orders, wallet top-ups and instalments — so a
        // stale or crafted link to a paid top-up would have wiped a real
        // order's only recoverable reference and then rendered "that's a
        // different payment". The render-time guard was too late.
        if (res.kind !== "order") {
          setSettled(true);
          setChecking(false);
          return;
        }

        if (res.paid) {
          // The one place the bag is emptied, and only once however many polls
          // land on it.
          if (!cleared.current) {
            cleared.current = true;
            cart.clear();
            reset();
            setPending(null);
          }
          setSettled(true);
          setChecking(false);
          return;
        }

        // Bank transfer and crypto are supposed to sit pending — a person
        // records receipt. Polling them is pointless and would just burn the
        // rate limit.
        if (res.payment_method === "bank_transfer" || res.payment_method === "crypto") {
          setSettled(true);
          setChecking(false);
          return;
        }

        const wait = RETRY_MS[attempt.current];
        if (wait === undefined) {
          setSettled(true);
          setChecking(false);
          return;
        }
        attempt.current += 1;
        timer.current = setTimeout(() => void check(ref), wait);
      } catch (err) {
        if (!alive.current) return;
        setChecking(false);
        setSettled(true);
        setError(
          err instanceof CheckoutError
            ? err.status === 404
              ? "We couldn’t find that payment. If money has left your account, contact us with your order reference and we’ll trace it."
              : err.message
            : "We couldn’t check your payment just now.",
        );
      }
    },
    [cart, reset, setPending],
  );

  useEffect(() => {
    alive.current = true;
    if (txRef) void check(txRef);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // check() is stable for a given reference; re-running on cart identity
    // would restart the poll every time the bag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txRef]);

  function again() {
    if (!txRef) return;
    attempt.current = 0;
    setSettled(false);
    void check(txRef);
  }

  /* ---------------- nothing to check ---------------- */

  if (!txRef) {
    return (
      <Result
        title="Nothing to confirm"
        body="We don’t have a payment to check. If you were part-way through an order, your bag is still here."
        primary={{ label: "Back to my bag", onPress: () => router.replace("/cart") }}
      />
    );
  }

  /* ---------------- wrong kind of reference ---------------- */

  if (status && status.kind !== "order") {
    return (
      <Result
        title="That’s a different payment"
        body={
          status.kind === "wallet_topup"
            ? "This reference belongs to a wallet top-up, not an order."
            : "This reference belongs to an instalment plan, not an order."
        }
        primary={{ label: "Back to shop", onPress: () => router.replace("/") }}
      />
    );
  }

  /* ---------------- still checking ---------------- */

  // `checking`, not `checking && !status`. Once the first poll answered, the
  // old guard fell through to the "we haven't seen this payment / no money has
  // been taken" copy for the whole remaining ~20s of the retry ladder — which
  // is exactly the declined-vs-not-yet-settled confusion this screen exists to
  // prevent, and a card paid by transfer or USSD settles inside that window.
  if (checking) {
    return (
      <CheckoutShell title="Payment" footerSpace={40}>
        <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 28 }}>
          <ActivityIndicator color={theme.colors.primary} />
          <Txt tone="ink" display size={22} center style={{ marginTop: 20 }}>
            Confirming your payment
          </Txt>
          <Txt tone="faint" size={13} center style={{ marginTop: 10, lineHeight: 19 }}>
            This takes a moment. Your bag is untouched until it clears.
          </Txt>
        </View>
      </CheckoutShell>
    );
  }

  const paid = Boolean(status?.paid);
  const ref = status?.ref ?? pending?.orderRef ?? "";
  const amount = status
    ? status.charge_currency && status.charge_currency !== "NGN"
      ? `${status.charge_amount} ${status.charge_currency}`
      : money(status.total)
    : pending
      ? money(pending.total)
      : "";

  /* ---------------- paid ---------------- */

  if (paid) {
    return (
      <Result
        tone="success"
        overline="PAYMENT CONFIRMED"
        title="Thank you — you’re all set"
        body={`Order ${ref} is paid${amount ? ` — ${amount}` : ""}. Your unique traceable code ships with the unit.`}
        primary={{ label: "Back to shop", onPress: () => router.replace("/") }}
        secondary={{ label: "View my orders", onPress: () => router.replace("/profile") }}
      />
    );
  }

  /* ---------------- bank transfer / crypto ---------------- */

  if (manualMethod) {
    return (
      <ManualInstructions
        ref_={ref}
        amount={amount}
        instructions={pending?.instructions as BankInstructions | CryptoInstructions | undefined}
        bottomInset={insets.bottom}
      />
    );
  }

  /* ---------------- not confirmed ---------------- */

  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 24 }}>
        <Overline>PAYMENT NOT CONFIRMED YET</Overline>
        <Txt tone="strong" display size={24} style={{ marginTop: 12 }}>
          We haven’t seen this payment
        </Txt>
        <Txt tone="body" size={13} style={{ marginTop: 12, lineHeight: 20 }}>
          No money has been taken for an attempt that did not go through, and your bag is
          untouched. If you did pay, it can take a moment to reach us — check again below.
        </Txt>

        {error ? (
          <View style={{ marginTop: 16 }}>
            <Notice tone="danger">{error}</Notice>
          </View>
        ) : null}

        <View style={{ marginTop: 18 }}>
          <SectionCard>
            <SummaryRow label="Order" value={ref || "—"} />
            {amount ? <SummaryRow label="Amount" value={amount} /> : null}
            <Divider />
            <Txt tone="faint" size={11} style={{ lineHeight: 16 }}>
              Quote this reference if you need to contact us about it.
            </Txt>
          </SectionCard>
        </View>

        <GradientButton
          label={checking ? "Checking…" : "Check again"}
          style={{ marginTop: 20 }}
          disabled={checking}
          onPress={again}
        />

        <Pressable
          onPress={() => router.replace("/checkout/payment")}
          accessibilityRole="button"
          style={({ pressed }) => [{ marginTop: 16, alignItems: "center" }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="primary" size={13} weight="medium">
            Try paying this order again
          </Txt>
        </Pressable>

        {/*
          The deliberate way out.

          `paid: false` means "not confirmed yet", never "declined" — a hosted
          page can be paid by transfer or USSD and settle minutes later — so
          the app must NOT release the attempt on its own: the next order would
          supersede a still-live payment and park real money on a cancelled
          order. But without any release the shopper was stuck in a loop, sent
          back here by every later tap on Pay, with no way to order again until
          the record aged out six hours later. So it is offered, with what it
          costs stated, and only they can take it.
        */}
        <Pressable
          onPress={() => {
            setPending(null);
            router.replace("/checkout/payment");
          }}
          accessibilityRole="button"
          accessibilityLabel="Abandon this attempt and start a new order"
          style={({ pressed }) => [{ marginTop: 18, alignItems: "center" }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="faint" size={12} center style={{ lineHeight: 17 }}>
            Abandon this attempt and start a new order. If this one does turn out to be
            paid, contact us with {ref || "the reference above"} and we’ll sort it out.
          </Txt>
        </Pressable>

        {__DEV__ && settled ? <DevSimulator txRef={txRef} onDone={again} /> : null}
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Bank transfer / crypto
 * ------------------------------------------------------------------ */

function ManualInstructions({
  ref_,
  amount,
  instructions,
  bottomInset,
}: {
  ref_: string;
  amount: string;
  instructions?: BankInstructions | CryptoInstructions;
  bottomInset: number;
}) {
  const bank = instructions?.type === "bank_transfer" ? instructions.bank : null;
  const crypto = instructions?.type === "crypto" ? instructions.crypto : null;

  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ paddingHorizontal: layout.gutter, marginTop: 24 }}>
        <Overline>ORDER PLACED</Overline>
        <Txt tone="strong" display size={24} style={{ marginTop: 12 }}>
          Send your payment
        </Txt>
        <Txt tone="body" size={13} style={{ marginTop: 12, lineHeight: 20 }}>
          Your pieces are reserved. We’ll confirm your order as soon as the payment lands —
          please quote the reference below so we can match it.
        </Txt>

        <View style={{ marginTop: 18 }}>
          <SectionCard>
            <SummaryRow label="Order" value={ref_ || "—"} />
            {amount ? <SummaryRow label="Amount" value={amount} strong /> : null}
            <Divider />
            <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4 }}>
              REFERENCE
            </Txt>
            <Txt tone="ink" size={14} weight="medium" selectable style={{ marginTop: 4 }}>
              {instructions?.reference ?? ref_}
            </Txt>
          </SectionCard>
        </View>

        {bank ? (
          <View style={{ marginTop: 12 }}>
            <SectionCard>
              <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4, marginBottom: 8 }}>
                BANK DETAILS
              </Txt>
              {bank.bank_name ? <SummaryRow label="Bank" value={bank.bank_name} /> : null}
              {bank.account_name ? <SummaryRow label="Account name" value={bank.account_name} /> : null}
              {bank.account_number ? (
                <View style={{ marginTop: 8 }}>
                  <Txt tone="faint" size={11}>
                    Account number
                  </Txt>
                  <Txt tone="ink" display size={20} selectable style={{ marginTop: 2 }}>
                    {bank.account_number}
                  </Txt>
                </View>
              ) : null}
            </SectionCard>
          </View>
        ) : null}

        {crypto ? (
          <View style={{ marginTop: 12 }}>
            <SectionCard>
              <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4, marginBottom: 8 }}>
                WALLET ADDRESSES
              </Txt>
              {crypto.usdt_address ? (
                <View style={{ marginBottom: 10 }}>
                  <Txt tone="faint" size={11}>
                    USDT{crypto.usdt_network ? ` · ${crypto.usdt_network}` : ""}
                  </Txt>
                  <Txt tone="ink" size={12.5} selectable style={{ marginTop: 3, lineHeight: 18 }}>
                    {crypto.usdt_address}
                  </Txt>
                </View>
              ) : null}
              {crypto.btc_address ? (
                <View>
                  <Txt tone="faint" size={11}>
                    Bitcoin
                  </Txt>
                  <Txt tone="ink" size={12.5} selectable style={{ marginTop: 3, lineHeight: 18 }}>
                    {crypto.btc_address}
                  </Txt>
                </View>
              ) : null}
            </SectionCard>
          </View>
        ) : null}

        {!instructions ? (
          <View style={{ marginTop: 12 }}>
            <Notice tone="info">
              We don’t have the payment details on this device any more. Contact us with the
              order reference above and we’ll send them again.
            </Notice>
          </View>
        ) : null}

        <GradientButton
          label="Back to shop"
          style={{ marginTop: 20, marginBottom: bottomInset + 10 }}
          onPress={() => router.replace("/")}
        />
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Result scaffold
 * ------------------------------------------------------------------ */

function Result({
  tone,
  overline,
  title,
  body,
  primary,
  secondary,
}: {
  tone?: "success";
  overline?: string;
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <CheckoutShell title="Payment" footerSpace={40}>
      <View style={{ alignItems: "center", paddingTop: 40, paddingHorizontal: 28 }}>
        {overline ? <Overline>{overline}</Overline> : null}
        <Txt
          tone={tone === "success" ? "success" : "strong"}
          display
          size={25}
          center
          style={{ marginTop: 12 }}
        >
          {title}
        </Txt>
        <Txt tone="body" size={13} center style={{ marginTop: 12, lineHeight: 20 }}>
          {body}
        </Txt>
        <GradientButton
          label={primary.label}
          style={{ marginTop: 28, alignSelf: "stretch" }}
          onPress={primary.onPress}
        />
        {secondary ? (
          <Pressable
            onPress={secondary.onPress}
            accessibilityRole="button"
            style={({ pressed }) => [{ marginTop: 18 }, pressed && { opacity: 0.7 }]}
          >
            <Txt tone="primary" size={13} weight="medium">
              {secondary.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </CheckoutShell>
  );
}

/* ------------------------------------------------------------------ *
 * Development only
 * ------------------------------------------------------------------ */

/**
 * Settle a test payment without a gateway.
 *
 * `__DEV__`-gated here and gated again on the server, which 404s the endpoint
 * unless that gateway has no real key AND the app is local AND FRONTEND_URL is
 * loopback. Note this calls the API directly rather than opening the
 * simulator's web page: that page lives at FRONTEND_URL — http://localhost:3000
 * — which on a phone means the phone itself.
 */
function DevSimulator({ txRef, onDone }: { txRef: string; onDone: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(outcome: "approve" | "fail") {
    setBusy(true);
    setNote(null);
    try {
      await simulatePayment(txRef, outcome);
      onDone();
    } catch (err) {
      setNote(
        err instanceof CheckoutError && err.status === 404
          ? "Simulator off for this gateway — it needs a gateway with no key, APP_ENV=local and a loopback FRONTEND_URL. Run `php artisan payments:check`."
          : err instanceof CheckoutError
            ? err.message
            : "Simulation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: 28, opacity: 0.9 }}>
      <Txt tone="faint" size={10.5} style={{ letterSpacing: 1.4 }}>
        DEVELOPMENT ONLY
      </Txt>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <Pressable
          onPress={() => void run("approve")}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [devBtn(theme), pressed && { opacity: 0.7 }]}
        >
          <Txt tone="success" size={12} weight="medium">
            Simulate approve
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => void run("fail")}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [devBtn(theme), pressed && { opacity: 0.7 }]}
        >
          <Txt tone="danger" size={12} weight="medium">
            Simulate fail
          </Txt>
        </Pressable>
      </View>
      {note ? (
        <Txt tone="faint" size={11} style={{ marginTop: 8, lineHeight: 16 }}>
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

const devBtn = (t: Theme) => ({
  flex: 1,
  height: 40,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: t.surfaces.lineCheckout,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});
