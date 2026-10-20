import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AccountShell, Empty, Failed, Loading, Panel, Pill } from "@/components/account-ui";
import { Field, Notice } from "@/components/checkout-ui";
import { Txt } from "@/components/ui";
import { claimCoupon, getCoupons, type CouponCard, type CouponWallet } from "@/lib/account-api";
import { useCart } from "@/lib/cart";
import { useCheckout } from "@/lib/checkout";
import { CheckoutError, previewCoupon } from "@/lib/checkout-api";
import { couponLabels } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Coupons.
 *
 * The list is not only coupons the customer has claimed — the server also
 * returns every live public offer they qualify for, so a valid one surfaces
 * without them having to be told it exists.
 *
 * Each coupon here is meant to be SPENDABLE from this screen, which is the
 * difference between a wallet and a receipt. "Use at checkout" asks the server
 * whether this code works for this shopper and this bag (GET is not enough —
 * eligibility depends on the basket), then writes it into the checkout draft
 * and sends them to the bag. The payment screen previews that code again on
 * arrival and applies it there, where the delivery fee is known — see the
 * seeding effect in `app/checkout/payment.tsx`. A coupon that cannot be used
 * right now says why in its own card instead of offering a button that will
 * fail.
 */

type Tab = "available" | "used" | "expired";

export default function CouponsScreen() {
  const s = useThemedStyles(makeS);
  const money = useApproxMoney();
  const cart = useCart();
  const { ready: checkoutReady, set: setDraft } = useCheckout();
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
      setError(err instanceof ApiError ? err.message : "We couldn’t load your coupons.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---- "Use at checkout", owned by the screen rather than by a card ---- */

  /** The code being checked, for that one card's label. */
  const [using, setUsing] = useState<string | null>(null);
  /** The server's refusal and which card it belongs to. */
  const [refusal, setRefusal] = useState<{ code: string; message: string } | null>(null);
  /**
   * One check at a time, across every card.
   *
   * A ref and not `using`, for the reason the payment screen keeps one too: a
   * second tap landing in the same frame reads the state the first tap has not
   * committed yet. This guard was per-card state, so two cards could be in
   * flight together and whichever reply came back last decided which code the
   * checkout carried.
   */
  const inFlight = useRef(false);
  /**
   * Whether anyone is still looking at this screen.
   *
   * `previewCoupon` can take the full 12s timeout, and the reply used to
   * navigate unconditionally. A shopper who tapped "Use at checkout" on a slow
   * connection, swiped back and opened their orders was thrown into a checkout
   * address form they had not asked for, out of a screen they had left.
   *
   * Focus and not merely mounted: a push leaves this screen alive underneath,
   * so a mounted check would still let the reply steal the navigation.
   */
  const onScreen = useRef(true);

  useFocusEffect(
    useCallback(() => {
      onScreen.current = true;
      return () => {
        onScreen.current = false;
      };
    }, []),
  );

  const useAtCheckout = useCallback(
    async (coupon: CouponCard) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setUsing(coupon.code);
      setRefusal(null);
      try {
        await previewCoupon(coupon.code, cart.subtotal, 0);
        // They are somewhere else now. Their coupon is not worth hijacking a
        // navigation for, and writing the draft would quietly arm a checkout
        // they walked away from.
        if (!onScreen.current) return;
        setDraft({ coupon: coupon.code });
        router.push("/checkout");
      } catch (err) {
        if (!onScreen.current) return;
        /*
         * The server's own refusal, and its field-scoped one by preference.
         *
         * `/coupons/apply` names the first rule this shopper fails in
         * `message` — "This code is for new customers only.", "You’ve already
         * used this code.", "Spend at least ₦200,000 to use this code.",
         * "This code can only be used on the website." — while a malformed
         * request comes back as Laravel's `{message, errors}`, whose `message`
         * is a summary that can trail off into "(and 2 more errors)".
         * `errors.code` is the sentence about the code itself. Our own wording
         * is reached only when the throw was not an API answer at all.
         */
        setRefusal({
          code: coupon.code,
          message:
            err instanceof CheckoutError
              ? (err.fieldError("code") ?? err.message)
              : "We couldn’t check that coupon just now.",
        });
      } finally {
        inFlight.current = false;
        setUsing(null);
      }
    },
    [cart.subtotal, setDraft],
  );

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
          ? `${res.coupon.code} is already in your coupons.`
          : `${res.coupon.code} added — ${couponLabels(res.coupon, money).discount}.`,
      );
      setCode("");
      await load();
    } catch (err) {
      /*
       * The server's own refusal, not a sentence of our own.
       *
       * `POST /coupons/claim` now runs the whole eligibility gate (the same one
       * the checkout runs) and names the first rule the shopper fails — for
       * members only, for new customers, already used, expired, not started
       * yet. Flattening that into "that code could not be added" would throw
       * away the only part of the answer they can act on.
       */
      setClaimError(
        err instanceof ApiError
          ? (err.fieldError("code") ?? err.message)
          : "That code could not be added.",
      );
    } finally {
      setClaiming(false);
    }
  }

  /*
   * Nothing is filtered out here any more.
   *
   * This screen used to drop every `app`-channel coupon, because both server
   * call sites evaluated a redemption as "web" — so a code written for the app
   * was refused BY the app, and showing one would have been offering something
   * that could not be redeemed. The API now identifies the client it is talking
   * to (`CouponService::channel()`), honours `app` here, and leaves public
   * offers for the other channel out of the response altogether.
   *
   * What still arrives, and must: a WEBSITE-ONLY coupon the shop gave this
   * customer. They hold it, so it stays visible and carries its own "use it on
   * the website" line — hiding a code they were handed looks like we withdrew it.
   */
  const lists: Record<Tab, CouponCard[]> = {
    available: wallet?.available ?? [],
    used: wallet?.used ?? [],
    expired: wallet?.expired ?? [],
  };
  const current = lists[tab];

  return (
    <AccountShell
      title="Coupons"
      subtitle="Discounts you hold, and offers you already qualify for."
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      {/* ---- add a coupon ---- */}
      <Panel style={{ marginTop: 18 }}>
        <Field
          account
          label="Have a coupon code?"
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
              accessibilityLabel="Add this coupon"
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

      {wallet === null && error === null ? <Loading label="Loading your coupons…" /> : null}
      {error && wallet === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {wallet ? (
        <>
          {/* ---- tabs ---- */}
          <View style={s.tabs}>
            {(["available", "used", "expired"] as Tab[]).map((t) => {
              const active = t === tab;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [s.tab, active && s.tabActive, pressed && { opacity: 0.8 }]}
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
                  ? "No coupons right now"
                  : tab === "used"
                    ? "Nothing used yet"
                    : "Nothing expired"
              }
              body={
                tab === "available"
                  ? "Offers you qualify for show up here automatically. If someone gave you a coupon code, add it above."
                  : "Coupons move here once they’ve been used or have run out of time."
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
  const s = useThemedStyles(makeS);
  const money = useApproxMoney();
  const cart = useCart();
  const { ready, set } = useCheckout();

  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  /*
   * NOT `coupon.discount_label` / `coupon.condition_label`.
   *
   * Those arrive from the server with a Naira sign already inside the string,
   * so they could never follow the shopper's chosen currency — this screen was
   * the clearest instance of the bug. The server now also sends the raw
   * `value`, `type` and `min_spend`, which is everything the two sentences are
   * made of, so they are assembled here instead.
   *
   * A coupon's worth is a price the SHOP set, like every other figure in the
   * catalogue, so it converts with the display currency (owner direction,
   * 2026-10-17). The amounts that stay in Naira are the ones the customer types
   * or that bound what they type — there are none of those on this screen.
   */
  const { discount, condition } = couponLabels(coupon, money);
  const spent = coupon.status !== "available";

  const minSpend = coupon.min_spend ?? 0;
  const shortfall = Math.max(0, minSpend - cart.subtotal);
  /** Website-only codes are real, they are just not spendable in here. */
  const elsewhere = coupon.channel === "web";
  const usableNow =
    !spent && !coupon.scheduled && !elsewhere && ready && cart.count > 0 && shortfall === 0;

  /**
   * Check the coupon against the live bag, then carry it into checkout.
   *
   * The check is `POST /coupons/apply` — the endpoint the payment screen uses
   * for its own preview. It is the only way to know whether THIS shopper can
   * spend THIS coupon on THIS bag: the wallet listing cannot answer it, because
   * half the rules (minimum spend, per-customer limit, new-customer status) are
   * about the basket and the history, not the coupon.
   *
   * Its figures are deliberately not shown here. Delivery is unknown until the
   * address step, and a free-shipping coupon's whole saving is the delivery —
   * previewing it against ₦0 would honestly report "you save ₦0". The payment
   * screen, which knows the fee, is where the saving belongs. All we take from
   * the reply is YES or the server's reason.
   *
   * The code lands in the checkout draft, which is what the payment screen
   * seeds its field from, so the shopper arrives with it typed for them and
   * taps Apply there. Applying it on their behalf would have to happen on that
   * screen — it owns the delivery fee the discount is computed against.
   */
  async function useAtCheckout() {
    setChecking(true);
    setRefused(null);
    try {
      await previewCoupon(coupon.code, cart.subtotal, 0);
      set({ coupon: coupon.code });
      router.push("/checkout");
    } catch (err) {
      setRefused(
        err instanceof CheckoutError ? err.message : "We couldn’t check that coupon just now.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Panel style={spent ? { opacity: 0.6 } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Txt tone="primary" display size={18}>
              {discount}
            </Txt>
            {coupon.badge ? <Pill label={coupon.badge} tone="warn" /> : null}
            {coupon.scheduled && coupon.starts_at ? (
              <Pill label={startsLabel(coupon.starts_at)} tone="warn" />
            ) : null}
            {!spent && elsewhere && coupon.channel_label ? (
              <Pill label={coupon.channel_label} tone="mute" />
            ) : null}
            {coupon.status === "used" ? <Pill label="Used" tone="mute" /> : null}
            {coupon.status === "expired" ? <Pill label="Expired" tone="bad" /> : null}
          </View>

          {coupon.description ? (
            <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
              {coupon.description}
            </Txt>
          ) : null}

          {/* The terms, in what-to-do-next form rather than small print. A
              minimum spend is only meaningful next to what is in the bag, so
              when there is a bag the two are said together — and when the bag
              already clears it, that is worth saying too. */}
          {minSpend === 0 ? (
            <Txt tone="body" size={9} style={{ marginTop: 6 }}>
              {condition}
            </Txt>
          ) : spent || cart.count === 0 ? (
            <Txt tone="body" size={9} style={{ marginTop: 6 }}>
              Spend at least {money(minSpend)}
            </Txt>
          ) : shortfall > 0 ? (
            <Txt tone="body" size={9} style={{ marginTop: 6 }}>
              Your bag is {money(cart.subtotal)} — add {money(shortfall)} to use this.
            </Txt>
          ) : (
            <Txt tone="success" size={9} style={{ marginTop: 6 }}>
              Your bag of {money(cart.subtotal)} qualifies.
            </Txt>
          )}

          {!spent && coupon.ends_at ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              {endsLabel(coupon.ends_at)}
            </Txt>
          ) : null}

          {!spent && elsewhere ? (
            <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
              This one is for the website — copy it and use it there.
            </Txt>
          ) : null}

          {!spent && !elsewhere && !coupon.scheduled && cart.count === 0 ? (
            <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
              Add something to your bag and this becomes spendable here.
            </Txt>
          ) : null}
        </View>
      </View>

      {refused ? (
        <View style={{ marginTop: 12 }}>
          <Notice tone="danger">{refused}</Notice>
        </View>
      ) : null}

      <View style={s.codeRow}>
        <Txt tone="strong" size={12} weight="medium" selectable style={{ letterSpacing: 1.2 }}>
          {coupon.code}
        </Txt>
      </View>

      {/* A spent coupon gets no actions at all. Copying a dead code, or being
          walked to a checkout that will refuse it, is worse than a quiet card. */}
      {!spent ? (
        <View style={s.actions}>
          <Pressable
            onPress={() => {
              void Clipboard.setStringAsync(coupon.code);
              setCopied(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Copy coupon code ${coupon.code}`}
            style={({ pressed }) => [s.action, pressed && { opacity: 0.75 }]}
          >
            <Text style={s.actionText}>{copied ? "Copied" : "Copy code"}</Text>
          </Pressable>

          {usableNow ? (
            <Pressable
              onPress={() => void useAtCheckout()}
              disabled={checking}
              accessibilityRole="button"
              accessibilityLabel={`Use coupon ${coupon.code} at checkout`}
              style={({ pressed }) => [
                s.action,
                s.actionStrong,
                checking && { opacity: 0.5 },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={[s.actionText, s.actionStrongText]}>
                {checking ? "Checking…" : "Use at checkout"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

/**
 * Dates in the terms a shopper acts on.
 *
 * Counted in CALENDAR days, not in 24-hour blocks: a coupon that dies at 23:59
 * tonight has to read "Ends today", and an hours-based difference would call it
 * "Ends in 0 days" or round it to tomorrow. Past a week the date itself is more
 * use than a countdown.
 */
function endsLabel(iso: string): string {
  const days = daysFromToday(iso);
  if (days === null) return `Use by ${onDate(iso)}`;
  if (days <= 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  if (days <= 7) return `Ends in ${days} days`;

  return `Use by ${onDate(iso)}`;
}

/** The same, for a coupon the shop has not opened yet. */
function startsLabel(iso: string): string {
  const days = daysFromToday(iso);
  if (days === null) return `Starts ${onDate(iso)}`;
  if (days <= 0) return "Starts today";
  if (days === 1) return "Starts tomorrow";

  return `Starts ${onDate(iso)}`;
}

/** Whole days between today and `iso`, or null when it is not a date. */
function daysFromToday(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

  return Math.round((midnight(d) - midnight(new Date())) / 86_400_000);
}

function onDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const makeS = (t: Theme) => StyleSheet.create({
  tabs: {
    flexDirection: "row",
    marginTop: 24,
    padding: 4,
    borderRadius: 13,
    backgroundColor: t.surfaces.segmentTrack,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: { backgroundColor: t.colors.surface },

  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.lineSoft,
  },

  // The account area's own two-button row (as on Invite a friend), so a coupon
  // card does not introduce a third kind of button to this tab.
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  action: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  actionStrong: { backgroundColor: t.colors.primary },
  actionText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },
  actionStrongText: { color: "#FFFFFF" },
});
