import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AccountShell,
  Divide,
  Failed,
  Line,
  Loading,
  Panel,
  Pill,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { Notice } from "@/components/checkout-ui";
import { OrderPaySheet } from "@/components/order-pay-sheet";
import { OrderPieceSheet } from "@/components/order-piece-sheet";
import { GradientButton, Txt } from "@/components/ui";
import { cancelOrder, getOrder, type Order, type OrderItem, type OrderStatus } from "@/lib/account-api";
import { signedMoney } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { openOrderReceipt } from "@/lib/receipt";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * One order, in full.
 *
 * The traceable codes live here, which is the point of the whole product: a
 * customer who cannot read back the code on the unit they were sent cannot use
 * the resale market or the ownership history the shop sells on.
 */

const STATUS: Record<OrderStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  pending: { label: "To pay", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  processing: { label: "Processing", tone: "mute" },
  shipped: { label: "Shipped", tone: "mute" },
  delivered: { label: "Delivered", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
  refunded: { label: "Refunded", tone: "bad" },
};

const STEPS: { key: keyof Order["timeline"]; label: string }[] = [
  { key: "placed_at", label: "Placed" },
  { key: "paid_at", label: "Paid" },
  { key: "shipped_at", label: "Shipped" },
  { key: "delivered_at", label: "Delivered" },
];

export default function OrderDetailScreen() {
  const theme = useTheme();
  // `s` is the status row below, so these are `styles` — as in account-ui.
  const styles = useThemedStyles(makeS);
  const money = useApproxMoney();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const numericId = Number(id);

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The pay sheet, and whatever the server last said about a payment. */
  const [paying, setPaying] = useState(false);
  const [payNote, setPayNote] = useState<string | null>(null);
  /** The piece whose sheet is open. */
  const [piece, setPiece] = useState<OrderItem | null>(null);
  /** Which value was last copied, so its button can say so. */
  const [copied, setCopied] = useState<string | null>(null);
  /** Minting the signed receipt link is a round trip, so the tap has a state. */
  const [receiptBusy, setReceiptBusy] = useState(false);

  function copy(text: string, what: string) {
    void Clipboard.setStringAsync(text);
    setCopied(what);
  }

  const load = useCallback(async () => {
    if (!Number.isFinite(numericId)) {
      setError("That order reference isn’t one we recognise.");
      return;
    }
    try {
      setOrder(await getOrder(numericId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load this order.");
    } finally {
      setRefreshing(false);
    }
  }, [numericId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open the printable receipt.
   *
   * The link is minted per tap and expires in half an hour, so it is never
   * cached or shared — and a failure has to be reported, because the browser
   * opening is the only signal the customer would otherwise get.
   */
  async function receipt() {
    if (!order || receiptBusy) return;
    setReceiptBusy(true);
    setError(null);
    try {
      await openOrderReceipt(order.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We couldn’t open that receipt. Please try again.",
      );
    } finally {
      setReceiptBusy(false);
    }
  }

  async function doCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      setOrder(await cancelOrder(numericId));
      setConfirming(false);
    } catch (err) {
      // The server refuses once any money has arrived, and says why. That
      // sentence is better than anything this screen could invent.
      setCancelError(err instanceof ApiError ? err.message : "This order could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  if (error && !order) {
    return (
      <AccountShell title="Order">
        <Failed message={error} onRetry={() => void load()} />
      </AccountShell>
    );
  }

  if (!order) {
    return (
      <AccountShell title="Order">
        <Loading label="Loading this order…" />
      </AccountShell>
    );
  }

  const s = STATUS[order.status] ?? { label: order.status, tone: "mute" as const };

  /**
   * The dispatch rows that actually have a value.
   *
   * The two shipping methods label the SAME two columns differently: on a
   * waybill `courier` is the transport company and `tracking_number` is the
   * waybill number quoted at the counter; on a logistics shipment they are the
   * courier and its tracking number. Printing "COURIER — ABC Transport" for a
   * waybill sent people to the wrong kind of enquiry.
   *
   * Filtered out here rather than in the JSX because the panel needs to know
   * whether it has any rows at all before it decides its own padding.
   */
  const waybill = order.delivery.fulfilment_type === "waybill";
  const dispatchRows = [
    { label: waybill ? "TRANSPORT COMPANY" : "COURIER", value: order.delivery.courier, copyable: false },
    {
      label: waybill ? "WAYBILL NUMBER" : "TRACKING NUMBER",
      value: order.delivery.tracking_number,
      copyable: true,
    },
    // flatMap rather than filter so the surviving rows are typed with a
    // non-null `value`; a filter leaves `string | null` behind and the copy
    // handler then has to re-prove what the filter already decided.
  ].flatMap((row) => (row.value ? [{ ...row, value: row.value }] : []));
  const canCancel =
    order.status === "pending" && !order.timeline.paid_at && order.amount_received === 0;
  /**
   * The order as something still owed.
   *
   * The server decides this — `invoice` is null on anything that is not
   * awaiting money — so the screen never re-derives "does this need paying"
   * from the status and gets it subtly wrong.
   */
  const invoice = order.invoice;
  const bank = invoice?.instructions?.type === "bank_transfer" ? invoice.instructions.bank : null;
  const crypto = invoice?.instructions?.type === "crypto" ? invoice.instructions.crypto : null;

  return (
    <AccountShell
      title={order.ref}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      <>
        {/* ---- status + timeline ---- */}
        <Panel>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
            <Txt tone="body" size={10} style={{ flex: 1 }}>
              {/* Tense matters on this line. An order awaiting money read
                  "Paid by bank transfer" — on the one screen where the
                  customer has come to find out whether they still owe
                  something. */}
              {order.payment_method
                ? `${invoice ? "To pay by" : "Paid by"} ${label(order.payment_method)}`
                : "Order"}
            </Txt>
            <Pill label={s.label} tone={s.tone} />
          </View>

          {STEPS.map((step, i) => {
            const at = order.timeline[step.key];
            const done = Boolean(at);
            return (
              <View key={step.key} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ alignItems: "center", width: 18 }}>
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: done ? theme.colors.success : theme.surfaces.lineProduct,
                    }}
                  />
                  {i < STEPS.length - 1 ? (
                    <View
                      style={{
                        width: 1,
                        height: 22,
                        backgroundColor: done ? theme.colors.success : theme.surfaces.lineProduct,
                      }}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1, paddingBottom: i < STEPS.length - 1 ? 10 : 0 }}>
                  <Txt tone={done ? "strong" : "body"} size={11} weight={done ? "medium" : "regular"}>
                    {step.label}
                  </Txt>
                  {at ? (
                    <Txt tone="body" size={9} style={{ marginTop: 2 }}>
                      {when(at)}
                    </Txt>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Panel>

        {order.superseded_by ? (
          <Notice tone="info">
            This attempt was replaced by a newer one ({order.superseded_by}). Nothing was charged
            for it.
          </Notice>
        ) : null}

        {/* ---- the invoice ----
            Directly under the timeline, because on an unpaid order this is the
            only thing on the screen the customer can act on. It did not exist:
            the hosted payment link was handed over once at checkout and never
            resurfaced, and the bank details arrived once in the checkout
            response — so an order that said "To pay" offered no way to pay it.

            The amount is in ₦ and nothing else. It is a figure being
            transacted and compared against a wallet balance, and the chosen
            display currency sits under it as the approximation it is. */}
        {invoice ? (
          <Panel>
            <SectionLabel>TO PAY</SectionLabel>

            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 10 }}>
              <Txt tone="strong" display size={30} style={{ lineHeight: 38 }}>
                {naira(invoice.amount_due)}
              </Txt>
            </View>
            {/* Only when the two differ — repeating the same figure twice
                reads as a second, slightly different amount. */}
            {money(invoice.amount_due) !== naira(invoice.amount_due) ? (
              <Txt tone="faint" size={10} style={{ marginTop: 5 }}>
                about {money(invoice.amount_due)} at today’s rate
              </Txt>
            ) : null}
            <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
              {/* No deadline is quoted, because orders here have none — see
                  the server's invoice payload. How long it has been waiting is
                  the honest version of the same nudge. */}
              {waitingFor(invoice.placed_at)} Your pieces stay reserved until it’s paid.
            </Txt>

            {invoice.awaiting ? (
              <View style={{ marginTop: 14 }}>
                <Notice tone="info">
                  A card payment on this order hasn’t been confirmed yet. Check it before paying
                  again — if it went through, paying now would charge you twice.
                </Notice>
              </View>
            ) : null}

            {/* The method on the order can stop being one the shop offers —
                the bank and crypto details are admin-managed, so an order
                placed as a transfer outlives the switch being turned off.
                Said here rather than drawn as an empty "transfer to" panel,
                which is what a blank detail bag used to produce. */}
            {methodWithdrawn(invoice) ? (
              <View style={{ marginTop: 14 }}>
                <Notice tone="info">
                  We can’t take {label(invoice.method ?? "")} for this order at the moment. Choose
                  another way to pay and we’ll keep everything else as it is.
                </Notice>
              </View>
            ) : null}

            {/* ---- how to send it, for the methods a person settles by hand ----
                These are the details the confirm screen used to apologise for
                not having any more ("contact us and we'll send them again"). */}
            {bank ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.detailLabel}>TRANSFER TO</Text>
                <View style={styles.payWell}>
                  {bank.bank_name ? (
                    <Txt tone="body" size={10.5}>
                      {bank.bank_name}
                      {bank.account_name ? ` · ${bank.account_name}` : ""}
                    </Txt>
                  ) : null}
                  {bank.account_number ? (
                    <View
                      style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}
                    >
                      <Txt tone="strong" display size={20} selectable style={{ flex: 1 }}>
                        {bank.account_number}
                      </Txt>
                      <CopyButton
                        label={copied === "ACCOUNT" ? "Copied" : "Copy"}
                        onPress={() => copy(bank.account_number ?? "", "ACCOUNT")}
                        styles={styles}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {crypto ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.detailLabel}>SEND TO</Text>
                <View style={styles.payWell}>
                  {crypto.usdt_address ? (
                    <View>
                      <Txt tone="body" size={10.5}>
                        USDT{crypto.usdt_network ? ` · ${crypto.usdt_network}` : ""}
                      </Txt>
                      <View
                        style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}
                      >
                        <Txt tone="strong" size={11} selectable style={{ flex: 1, lineHeight: 17 }}>
                          {crypto.usdt_address}
                        </Txt>
                        <CopyButton
                          label={copied === "USDT" ? "Copied" : "Copy"}
                          onPress={() => copy(crypto.usdt_address ?? "", "USDT")}
                          styles={styles}
                        />
                      </View>
                    </View>
                  ) : null}
                  {crypto.btc_address ? (
                    <View style={{ marginTop: crypto.usdt_address ? 12 : 0 }}>
                      <Txt tone="body" size={10.5}>
                        Bitcoin
                      </Txt>
                      <View
                        style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}
                      >
                        <Txt tone="strong" size={11} selectable style={{ flex: 1, lineHeight: 17 }}>
                          {crypto.btc_address}
                        </Txt>
                        <CopyButton
                          label={copied === "BTC" ? "Copied" : "Copy"}
                          onPress={() => copy(crypto.btc_address ?? "", "BTC")}
                          styles={styles}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* The reference is the whole of how a manual payment finds its
                way back to this order, so it is given its own row and a copy
                button rather than being quoted inside a sentence. */}
            {invoice.instructions?.reference ? (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.detailLabel}>QUOTE THIS REFERENCE</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 5 }}>
                  <Txt
                    tone="strong"
                    size={13}
                    weight="medium"
                    selectable
                    style={{ flex: 1, letterSpacing: 0.4 }}
                  >
                    {invoice.instructions.reference}
                  </Txt>
                  <CopyButton
                    label={copied === "REFERENCE" ? "Copied" : "Copy"}
                    onPress={() => copy(invoice.instructions?.reference ?? "", "REFERENCE")}
                    styles={styles}
                  />
                </View>
              </View>
            ) : null}

            {payNote ? (
              <View style={{ marginTop: 14 }}>
                <Notice tone="info">{payNote}</Notice>
              </View>
            ) : null}

            {/* The server's own `payable` decides whether there is a button at
                all, and its `reason` is the sentence shown instead. A button
                the server would refuse is worse than no button. */}
            {invoice.payable ? (
              <GradientButton
                label={
                  invoice.awaiting
                    ? "Check or change this payment"
                    : order.payment_method === "bank_transfer" || order.payment_method === "crypto"
                      ? "Pay now, or change the method"
                      : `Pay ${naira(invoice.amount_due)}`
                }
                style={{ marginTop: 16 }}
                onPress={() => {
                  setPayNote(null);
                  setPaying(true);
                }}
              />
            ) : (
              <View style={{ marginTop: 14 }}>
                <Notice tone="info">{invoice.reason ?? "This order can’t be paid here."}</Notice>
              </View>
            )}
          </Panel>
        ) : null}

        {/* ---- the shop's message ----
            First, under the timeline, because it is the one part of this screen
            a person wrote by hand about this particular order — "balance of
            ₦185,000 outstanding", "collect before Friday". Buried under the
            pieces it would be read after the customer had already decided
            nothing had happened. The cream well is the same warm surface the
            storefront uses for its own voice, so it reads as the shop speaking
            rather than as another field of the order. */}
        {order.admin_note ? (
          <Panel>
            <SectionLabel>A MESSAGE FROM US</SectionLabel>
            <View style={styles.shopNote}>
              <Txt tone="strong" size={11} selectable style={{ lineHeight: 18 }}>
                {order.admin_note}
              </Txt>
            </View>
          </Panel>
        ) : null}

        {/* ---- how it is getting to them ----
            The whole section is conditional on there being something in it. An
            order placed an hour ago has no method, no courier, no number and no
            terminal, and a panel headed "HOW IT'S COMING" over nothing at all
            reads as a broken screen rather than as "not dispatched yet". */}
        {hasDispatch(order) ? (
          <Panel padded={false}>
            {/* The heading block carries the panel's bottom padding itself when
                nothing follows it — a dispatch desk can be chosen before the
                courier is booked, and the alternative is a panel that ends
                flush against its own last line of text. */}
            <View
              style={{
                padding: 16,
                paddingBottom: dispatchRows.length || order.delivery.pickup_terminal ? 0 : 16,
              }}
            >
              <SectionLabel>HOW IT’S COMING</SectionLabel>
              <Txt tone="strong" size={12} weight="medium" style={{ marginTop: 8, lineHeight: 18 }}>
                {fulfilmentHeadline(order.delivery.fulfilment_type)}
              </Txt>
            </View>

            {dispatchRows.length ? (
              <View style={{ marginTop: 14 }}>
                {dispatchRows.map((row, i) => (
                  <View key={row.label} style={styles.detailRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailLabel}>{row.label}</Text>
                      <Txt tone="strong" size={13} weight="medium" selectable style={{ marginTop: 5 }}>
                        {row.value}
                      </Txt>
                    </View>
                    {/* Copyable because the next thing anyone does with a
                        tracking number is paste it into the carrier's site, and
                        retyping a 12-character reference off a phone screen is
                        where the typo comes from. */}
                    {row.copyable ? (
                      <Pressable
                        onPress={() => copy(row.value, row.label)}
                        accessibilityRole="button"
                        accessibilityLabel={`Copy ${row.label.toLowerCase()}`}
                        hitSlop={8}
                        style={({ pressed }) => [styles.copySmall, pressed && { opacity: 0.75 }]}
                      >
                        <Text style={styles.copySmallText}>
                          {copied === row.label ? "Copied" : "Copy"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {i < dispatchRows.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {/* The collection point gets the loudest treatment on the screen.
                On a waybill the parcel is not coming to the door — somebody has
                to go and get it, and this line is the only thing on the order
                that says where. */}
            {order.delivery.pickup_terminal ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  // The last dispatch row already ends on 13px of its own; with
                  // no rows above, this block has to open the gap itself.
                  paddingTop: dispatchRows.length ? 3 : 14,
                  paddingBottom: 16,
                }}
              >
                <Text style={styles.detailLabel}>COLLECT YOUR PARCEL AT</Text>
                <View style={styles.terminalWell}>
                  <Txt tone="strong" display size={16} selectable style={{ lineHeight: 23 }}>
                    {order.delivery.pickup_terminal}
                  </Txt>
                </View>
                <Txt tone="body" size={10} style={{ marginTop: 9, lineHeight: 15 }}>
                  {/* Names the number by the label it is actually printed
                      under above, which flips with the dispatch method. */}
                  {order.delivery.tracking_number
                    ? `Bring the ${waybill ? "waybill" : "tracking"} number above and a means of identification.`
                    : "Bring a means of identification."}
                </Txt>
              </View>
            ) : null}
          </Panel>
        ) : null}

        {/* ---- items ---- */}
        <Panel>
          <SectionLabel>{order.items.length === 1 ? "PIECE" : "PIECES"}</SectionLabel>
          <View style={{ marginTop: 12, gap: 14 }}>
            {order.items.map((i) => (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                accessibilityLabel={`${i.name}. Open details`}
                onPress={() => setPiece(i)}
                style={({ pressed }) => [{ flexDirection: "row", gap: 12 }, pressed && { opacity: 0.7 }]}
              >
                <Thumb src={i.image} seed={i.slug ?? String(i.id)} alt={i.name} width={52} height={60} />
                <View style={{ flex: 1 }}>
                  <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 16 }}>
                    {i.name}
                  </Txt>
                  {[i.length, i.colour, i.density].filter(Boolean).length ? (
                    <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                      {[i.length, i.colour, i.density].filter(Boolean).join(" · ")}
                    </Txt>
                  ) : null}
                  {i.preparation ? (
                    <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                      {[i.preparation, i.preparation_style].filter(Boolean).join(" · ")}
                      {i.surcharge > 0 ? ` · + ${money(i.surcharge)}` : ""}
                    </Txt>
                  ) : null}

                  {/* The unit's own code, on the unit. It used to sit in a
                      section of its own with a paragraph explaining what it
                      was for; against the piece it belongs to, it needs no
                      explaining. */}
                  {i.codes.map((c) => (
                    <Txt
                      key={c}
                      tone="strong"
                      size={10}
                      weight="medium"
                      selectable
                      style={{ marginTop: 5, letterSpacing: 0.6 }}
                    >
                      {c}
                    </Txt>
                  ))}
                  <View style={{ flexDirection: "row", marginTop: 6, alignItems: "center" }}>
                    <Txt tone="body" size={9} style={{ flex: 1 }}>
                      Qty {i.qty}
                    </Txt>
                    <Txt tone="strong" size={11} weight="medium">
                      {money(i.line_total)}
                    </Txt>
                    {/* Without this the row looks like a static summary and
                        nobody discovers it opens. */}
                    <Txt tone="faint" size={14} style={{ marginLeft: 8, marginTop: -2 }}>
                      ›
                    </Txt>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </Panel>

        {/* ---- money ---- */}
        <Panel>
          <SectionLabel>TOTAL</SectionLabel>
          <View style={{ marginTop: 10 }}>
            <Line label="Subtotal" value={money(order.totals.subtotal)} />
            <Line
              label="Delivery"
              value={order.totals.delivery === 0 ? "Free" : money(order.totals.delivery)}
              tone={order.totals.delivery === 0 ? "success" : "body"}
            />
            {order.totals.discount > 0 ? (
              <Line
                label={order.coupon_code ? `Discount (${order.coupon_code})` : "Discount"}
                value={signedMoney(money(order.totals.discount), "−")}
                tone="success"
              />
            ) : null}
            <Divide />
            <Line label="Total" value={money(order.totals.total)} strong />
            {order.amount_received > 0 && order.amount_received < order.totals.total ? (
              <Line label="Received so far" value={money(order.amount_received)} />
            ) : null}
          </View>
          
          {/*
            The receipt, reachable from the order it belongs to.
          
            It existed only on the post-checkout confirmation screen, which
            renders once — so the day after buying there was no way to get a
            receipt at all, and the printed copy is the one place the traceable
            LXU- codes survive a lost phone.
          
            Not labelled a PDF: it opens a printable page and the browser's own
            Print → Save as PDF does the saving. Promising a PDF would promise a
            file this app cannot produce.
          */}
          <Pressable
            onPress={() => void receipt()}
            disabled={receiptBusy}
            accessibilityRole="button"
            accessibilityLabel="View or print your receipt"
            style={({ pressed }) => [styles.receipt, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.receiptText}>
              {receiptBusy ? "Opening…" : "View / print receipt"}
            </Text>
          </Pressable>
        </Panel>

        {/* ---- delivery ---- */}
        <Panel>
          <SectionLabel>DELIVERING TO</SectionLabel>
          <Txt tone="strong" size={11} weight="medium" style={{ marginTop: 12 }}>
            {order.customer.name}
          </Txt>
          {order.customer.phone ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              {order.customer.phone}
            </Txt>
          ) : null}
          <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            {[
              order.delivery.address,
              order.delivery.city,
              order.delivery.state,
              order.delivery.zip,
            ]
              .filter(Boolean)
              .join(", ")}
          </Txt>
          {/* Labelled at all, because the panel above now carries a message
              from the shop and a bare "Note:" between the two says nothing
              about which of them is talking.

              NOT labelled "your note", though it is the customer's field at
              checkout: the admin order screen offers the SAME column as "Note
              to customer" and the team writes dispatch lines into it, so on a
              real order it reads "Dispatched today - collect with your ID".
              A possessive label would put the shop's words in the buyer's
              mouth. Sitting inside the address panel as plain body text is
              distinction enough from the cream message well above. */}
          {order.delivery.note ? (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.detailLabel}>DELIVERY NOTE</Text>
              <Txt tone="body" size={10} style={{ marginTop: 5, lineHeight: 16 }}>
                {order.delivery.note}
              </Txt>
            </View>
          ) : null}
        </Panel>

        {/* ---- cancel ---- */}
        {canCancel ? (
          <View style={{ marginTop: 2 }}>
            {cancelError ? (
              <View style={{ marginBottom: 12 }}>
                <Notice tone="danger">{cancelError}</Notice>
              </View>
            ) : null}

            {confirming ? (
              <Panel>
                <Txt tone="strong" size={12} weight="medium">
                  Cancel this order?
                </Txt>
                <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
                  The pieces go back on sale and any code you used is released. This cannot be
                  undone.
                </Txt>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => setConfirming(false)}
                    accessibilityRole="button"
                    style={({ pressed }) => [keepBtn(theme), pressed && { opacity: 0.7 }]}
                  >
                    <Txt tone="primary" size={13} weight="medium">
                      Keep it
                    </Txt>
                  </Pressable>
                  <GradientButton
                    label={cancelling ? "Cancelling…" : "Yes, cancel"}
                    disabled={cancelling}
                    style={{ flex: 1 }}
                    onPress={() => void doCancel()}
                  />
                </View>
              </Panel>
            ) : (
              <Pressable
                onPress={() => setConfirming(true)}
                accessibilityRole="button"
                accessibilityLabel="Cancel this order"
                style={({ pressed }) => [{ alignItems: "center", paddingVertical: 14 }, pressed && { opacity: 0.7 }]}
              >
                <Txt tone="danger" size={13} weight="medium">
                  Cancel this order
                </Txt>
              </Pressable>
            )}
          </View>
        ) : null}

        {/* The invoice panel above has already said why this order can't be
            paid here; this adds only the half it doesn't cover, rather than
            repeating the same paragraph in different words. */}
        {order.status === "pending" && !canCancel ? (
          <Notice tone="info">
            It can’t be cancelled here either, for the same reason — get in touch and we’ll sort it
            out.
          </Notice>
        ) : null}

        <Pressable
          onPress={() => router.replace("/shop")}
          accessibilityRole="button"
          style={({ pressed }) => [{ alignItems: "center", paddingVertical: 10 }, pressed && { opacity: 0.7 }]}
        >
          <Txt tone="primary" size={13} weight="medium">
            Continue shopping
          </Txt>
        </Pressable>
      </>

      <OrderPieceSheet
        item={piece}
        open={piece !== null}
        onClose={() => setPiece(null)}
        bottomInset={insets.bottom}
      />

      <OrderPaySheet
        order={order}
        open={paying}
        onClose={() => setPaying(false)}
        onDone={(message, fresh) => {
          setPaying(false);
          setPayNote(message);
          // The server hands back the order row for a wallet or manual
          // payment, which settles or re-targets inside the request. A card
          // payment resolves later, so the screen is re-read instead — the
          // webhook may have settled it while the browser sheet was open.
          if (fresh) setOrder(fresh);
          else void load();
        }}
        bottomInset={insets.bottom}
      />
    </AccountShell>
  );
}

/** One small copy control, used by every reference on the invoice. */
function CopyButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: { copySmall: object; copySmallText: object };
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Copy"
      hitSlop={8}
      style={({ pressed }) => [styles.copySmall, pressed && { opacity: 0.75 }]}
    >
      <Text style={styles.copySmallText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Has the method this order is on stopped being one the shop can take?
 *
 * Only asked of the two manual methods: a gateway with no key is a shop-wide
 * outage the customer can do nothing about and the sheet simply stops offering
 * it, whereas a withdrawn transfer account leaves an order pointing at details
 * that no longer exist — which is the customer's problem to be told about.
 */
function methodWithdrawn(invoice: NonNullable<Order["invoice"]>): boolean {
  const method = invoice.method;
  if (method !== "bank_transfer" && method !== "crypto") return false;

  return invoice.methods?.[method] === false;
}

/**
 * How long this order has been waiting for money.
 *
 * Not a deadline — orders here have no expiry, and inventing one would have the
 * customer planning around a date the shop would not act on. What it does is
 * turn "unpaid" into a fact with a shape: "placed today" reads very differently
 * from "waiting since 3 Oct", and the second is the one that gets paid.
 */
function waitingFor(placedAt: string | null): string {
  if (!placedAt) return "This order is waiting for payment.";

  const d = new Date(placedAt);
  if (Number.isNaN(d.getTime())) return "This order is waiting for payment.";

  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "Placed today, and waiting for payment.";
  if (days === 1) return "Waiting for payment since yesterday.";

  return `Waiting for payment since ${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })} — ${days} days.`;
}

/**
 * Is there anything to say about the journey yet?
 *
 * Four nullable columns, all empty until the team dispatches. Asked as one
 * question so the panel and its heading appear together or not at all.
 */
function hasDispatch(order: Order): boolean {
  const d = order.delivery;
  return Boolean(d.fulfilment_type || d.courier || d.tracking_number || d.pickup_terminal);
}

/**
 * The method, in words a customer can act on.
 *
 * The raw values are `waybill` and `logistics`, which are the shop's own terms
 * for its two dispatch desks and mean nothing to a buyer. What a buyer needs
 * from this line is whether to expect a knock or to plan a trip, so each one
 * says that outright. Null is left vague on purpose — a courier or a number has
 * been filled in without the method being set, and guessing which desk it came
 * from would be worse than "on its way".
 */
function fulfilmentHeadline(type: Order["delivery"]["fulfilment_type"]): string {
  if (type === "waybill") return "Sent by waybill — you collect it at the terminal";
  if (type === "logistics") return "Courier delivery, to the address below";
  return "On its way";
}

const makeS = (t: Theme) => StyleSheet.create({
  /** The receipt control: a quiet tinted pill, not a second primary CTA. */
  receipt: {
    marginTop: 16,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptText: { fontFamily: fonts.medium, fontSize: 12.5, color: t.colors.primaryOn },

  /**
   * The shop's voice, in the warm cream the brand uses for its own bands.
   *
   * Deliberately not the gold `Notice` tint: Notice is for a state the app is
   * reporting (something failed, something is pending) and this is prose a
   * person wrote.
   */
  shopNote: {
    marginTop: 10,
    backgroundColor: t.surfaces.noteTint,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },

  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  detailLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
    includeFontPadding: false,
  },
  // Absolute and inset, so it hairlines between rows without adding height and
  // without drawing under the panel's own rounded corner.
  rowDivider: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.lineSoft,
  },

  copySmall: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  copySmallText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  // Account numbers and wallet addresses, on the same recessed surface the
  // waybill terminal uses: a value to be read off a screen and typed into
  // something else, so it is set apart from the prose around it.
  payWell: {
    marginTop: 6,
    backgroundColor: t.surfaces.stepperTrack,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },

  // The one thing on a waybill order that decides whether the parcel is ever
  // collected, so it gets a well of its own rather than a label and a line.
  terminalWell: {
    marginTop: 7,
    backgroundColor: t.surfaces.stepperTrack,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
});

const keepBtn = (t: Theme) => ({
  flex: 1,
  height: 54,
  borderRadius: 27,
  borderWidth: 1,
  borderColor: t.surfaces.line,
  alignItems: "center" as const,
  justifyContent: "center" as const,
});

function label(method: string): string {
  if (method === "bank_transfer") return "bank transfer";
  if (method === "wallet") return "wallet credit";
  return method;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
