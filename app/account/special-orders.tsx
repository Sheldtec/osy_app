import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { QuotePaySheet } from "@/components/quote-pay-sheet";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApproxMoney } from "@/lib/currency-context";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import {
  cancelSpecialOrder,
  createSpecialOrder,
  getSpecialOrders,
  verifyQuotePayment,
  MAX_IMAGES,
  MIN_DESCRIPTION,
  type SpecialOrder,
  type SpecialOrderStatus,
} from "@/lib/special-orders-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Special orders — "find me this piece".
 *
 * Describe hair we don't stock, attach reference photos, and the shop comes
 * back with a quote. ACCEPTING THE QUOTE PAYS IT — from the wallet, or by card
 * through either hosted gateway (see `QuotePaySheet`, which owns that choice).
 * Until recently the wallet was the only route, so a customer quoted more than
 * their store credit could not accept their own quote at all.
 *
 * This screen never decides that something has been paid. It prints what the
 * server told it: `payment.payable` says whether paying is possible at all, and
 * `payment.awaiting` marks a card payment already in flight — for which the
 * only honest action is to go and ask the server again, not to charge a second
 * time.
 *
 * Photos are the strict CUSTOMER upload tier: JPEG and PNG only, magic-byte
 * checked server-side, so a renamed .webp is refused however the picker
 * labelled it. They are re-encoded to bounded JPEG before sending (see
 * `createSpecialOrder`), because one oversized file rejects the whole batch.
 */

const STATUS: Record<SpecialOrderStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  pending: { label: "Sent", tone: "mute" },
  reviewing: { label: "Being sourced", tone: "mute" },
  quoted: { label: "Quote ready", tone: "warn" },
  accepted: { label: "Paid", tone: "ok" },
  in_progress: { label: "In progress", tone: "ok" },
  fulfilled: { label: "Delivered", tone: "ok" },
  declined: { label: "Couldn’t source", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "mute" },
};

type Shot = { uri: string; width: number; height: number };

export default function SpecialOrdersScreen() {
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { signedIn } = useAuth();
  const money = useApproxMoney();

  const [rows, setRows] = useState<SpecialOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** The quote whose payment sheet is open. */
  const [paying, setPaying] = useState<SpecialOrder | null>(null);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [length, setLength] = useState("");
  const [colour, setColour] = useState("");
  const [budget, setBudget] = useState("");
  const [photos, setPhotos] = useState<Shot[]>([]);
  const [sending, setSending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      setRows(await getSpecialOrders());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your requests.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  async function addPhoto() {
    setFields({});
    if (photos.length >= MAX_IMAGES) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setFields({ images: "We need photo access to attach a reference picture." });

      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      selectionLimit: MAX_IMAGES - photos.length,
      allowsMultipleSelection: true,
    });
    if (res.canceled || !res.assets?.length) return;

    setPhotos((prev) =>
      [...prev, ...res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(
        0,
        MAX_IMAGES,
      ),
    );
  }

  async function send() {
    setFields({});
    setNotice(null);

    const local: Record<string, string> = {};
    if (title.trim().length < 2) local.title = "Give it a short title.";
    if (description.trim().length < MIN_DESCRIPTION) {
      local.description = `Please describe the hair in a bit more detail (at least ${MIN_DESCRIPTION} characters).`;
    }
    if (photos.length === 0) local.images = "Please add at least one reference photo.";

    if (Object.keys(local).length) {
      setFields(local);

      return;
    }

    setSending(true);
    try {
      const created = await createSpecialOrder({
        title,
        description,
        length: length || undefined,
        colour: colour || undefined,
        budget: budget ? Number(budget.replace(/[^\d]/g, "")) : undefined,
        photos,
      });
      setRows((prev) => [created, ...(prev ?? [])]);
      setComposing(false);
      setTitle("");
      setDescription("");
      setLength("");
      setColour("");
      setBudget("");
      setPhotos([]);
      setNotice("Sent. We’ll come back to you with a quote.");
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {};
        for (const k of ["title", "description", "length", "colour", "budget", "needed_by"]) {
          const msg = err.fieldError(k);
          if (msg) map[k] = msg;
        }
        // Per-file errors arrive keyed images.0, images.1 … — surface the first.
        const img =
          err.fieldError("images") ??
          err.fields?.["images.0"]?.[0] ??
          err.fields?.["images.1"]?.[0] ??
          err.fields?.["images.2"]?.[0];
        if (img) map.images = img;

        setFields(map);
        if (Object.keys(map).length === 0) setNotice(err.message);
      } else {
        setNotice("That didn’t send. Please try again.");
      }
    } finally {
      setSending(false);
    }
  }

  async function cancel(row: SpecialOrder) {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await cancelSpecialOrder(row.id);
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? res.special_order : r)));
      setNotice("That request has been cancelled.");
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "That didn’t go through.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Ask the server about a card payment that is already in flight.
   *
   * This exists for the customer who paid and then lost the app — a redirect
   * that never came back, a phone call, a dead battery. The alternative on
   * offer would be paying a second time, which is why this is a button and the
   * second charge is not.
   */
  async function checkPayment(row: SpecialOrder) {
    const ref = row.payment.check_ref;
    if (!ref) return;

    setNotice(null);
    setBusyId(row.id);
    try {
      const status = await verifyQuotePayment(ref);
      setNotice(
        status.paid
          ? `Paid ${naira(status.total)}. ${row.ref} is confirmed.`
          : status.attempt_status === "unapplied"
            ? "That payment went through, but this request had already closed. We’ve recorded it and the team will be in touch to put it right."
            : "We haven’t seen that payment yet. If you completed it, give it a moment and check again.",
      );
      // Whatever the answer, the row itself is the authority on what is paid.
      await load(true);
    } catch (err) {
      setNotice(
        err instanceof ApiError
          ? err.message
          : "We couldn’t check that payment just now. Please try again in a moment.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /** What the payment sheet reports back, printed verbatim — never reinterpreted. */
  function paymentDone(message: string, updated?: SpecialOrder) {
    setPaying(null);
    setNotice(message);
    if (updated) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
    }
    // A card payment settles server-side, so the row is re-read either way.
    void load(true);
  }

  if (!signedIn) {
    return (
      <AccountShell title="Special orders" subtitle="Ask us to find a piece we don't stock.">
        <Empty
          title="Sign in to make a request"
          body="We reply to a special order through your account, so you'll need to be signed in."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Special orders"
      subtitle="Can’t find it? Describe it and we’ll source it."
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
      footerSpace={120}
      footer={
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
          <GradientButton
            label={composing ? (sending ? "Sending…" : "Send request") : "Ask for a piece"}
            disabled={sending}
            onPress={() => (composing ? void send() : setComposing(true))}
          />
          {composing && !sending ? (
            <Pressable
              onPress={() => setComposing(false)}
              accessibilityRole="button"
              style={{ alignItems: "center", paddingVertical: 12 }}
            >
              <Text style={s.cancelText}>Not now</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {/* ---------------- the form ---------------- */}
      {composing ? (
        <>
          <SectionLabel>WHAT ARE YOU AFTER</SectionLabel>
          <Panel>
            <Field
              account
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="Deep wave frontal wig, 24 inch"
              error={fields.title}
            />
            <Field
              account
              label="Describe it"
              value={description}
              onChangeText={setDescription}
              placeholder="Texture, density, cap, lace, how you'll wear it — the more you say, the closer we get."
              multiline
              numberOfLines={4}
              error={fields.description}
              hint={`At least ${MIN_DESCRIPTION} characters.`}
              style={{ marginTop: 16 }}
            />
            <Field
              account
              label="Length (optional)"
              value={length}
              onChangeText={setLength}
              placeholder='24"'
              style={{ marginTop: 16 }}
              error={fields.length}
            />
            <Field
              account
              label="Colour (optional)"
              value={colour}
              onChangeText={setColour}
              placeholder="Natural black"
              style={{ marginTop: 16 }}
              error={fields.colour}
            />
            <Field
              account
              label="Budget (optional)"
              value={budget}
              onChangeText={setBudget}
              placeholder="250000"
              keyboardType="number-pad"
              hint="In Naira. It helps us aim at the right piece."
              style={{ marginTop: 16 }}
              error={fields.budget}
            />
          </Panel>

          <SectionLabel>REFERENCE PHOTOS</SectionLabel>
          <Panel>
            <Txt tone="body" size={10} style={{ lineHeight: 15 }}>
              Up to {MAX_IMAGES} pictures of the look you want. JPG or PNG.
            </Txt>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 14 }}
            >
              {photos.map((p, i) => (
                <View key={p.uri} style={s.shot}>
                  <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((_, k) => k !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${i + 1}`}
                    hitSlop={8}
                    style={s.shotX}
                  >
                    <Text style={s.shotXText}>✕</Text>
                  </Pressable>
                </View>
              ))}

              {photos.length < MAX_IMAGES ? (
                <Pressable
                  onPress={() => void addPhoto()}
                  accessibilityRole="button"
                  accessibilityLabel="Add a reference photo"
                  style={({ pressed }) => [s.shot, s.shotAdd, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.shotAddText}>＋</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            {fields.images ? (
              <Txt tone="danger" size={11} style={{ lineHeight: 15 }}>
                {fields.images}
              </Txt>
            ) : null}
          </Panel>
        </>
      ) : null}

      {notice ? (
        <Panel style={{ marginTop: composing ? 16 : 4 }}>
          <Txt tone="body" size={11} style={{ lineHeight: 16 }}>
            {notice}
          </Txt>
        </Panel>
      ) : null}

      {/* ---------------- the list ---------------- */}
      {!composing ? (
        <>
          {rows === null && error === null ? <Loading label="Loading your requests…" /> : null}
          {error && rows === null ? <Failed message={error} onRetry={() => void load()} /> : null}

          {rows?.length === 0 ? (
            // No action here: the pinned footer already carries "Ask for a
            // piece" and is always on screen, so an action button here just
            // showed the same CTA twice.
            <Empty
              title="No requests yet"
              body="If there's a piece you've seen elsewhere, describe it and send a photo — we'll tell you what we can do and what it would cost."
            />
          ) : null}

          {rows?.map((row) => {
            const st = STATUS[row.status] ?? { label: row.status, tone: "mute" as const };
            // The SERVER's answer to "can this be paid", not this screen's
            // reading of the lifecycle — the two drifting apart is how a
            // customer ends up tapping a button that only ever 422s.
            const quoted = row.payment.payable;
            const awaiting = row.payment.awaiting;
            /**
             * A card payment we can still ask about. Offered alongside paying
             * once it has stopped blocking: the customer who paid and lost the
             * redirect needs a way to find out, and that way must never be
             * "pay again and see".
             */
            const checkable = Boolean(row.payment.check_ref) && row.amount_paid === 0;
            const cancellable = ["pending", "reviewing", "quoted", "accepted"].includes(row.status);
            const busy = busyId === row.id;

            return (
              <Panel key={row.id}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                  <Txt tone="strong" weight="medium" size={11} style={{ flex: 1 }}>
                    {row.ref}
                  </Txt>
                  <Pill label={st.label} tone={st.tone} />
                </View>

                <Txt tone="strong" size={13} weight="medium" style={{ lineHeight: 18 }}>
                  {row.title}
                </Txt>
                <Txt tone="body" size={10} numberOfLines={3} style={{ marginTop: 6, lineHeight: 15 }}>
                  {row.description}
                </Txt>

                {row.images.length ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
                  >
                    {row.images.map((src) => (
                      <View key={src} style={s.thumb}>
                        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                {row.quote_amount ? (
                  <View style={s.quote}>
                    <Txt tone="body" size={9}>
                      {row.amount_paid > 0 ? "YOU PAID" : "OUR QUOTE"}
                    </Txt>
                    <Txt tone="strong" display size={22} style={{ marginTop: 4 }}>
                      {money(row.amount_paid > 0 ? row.amount_paid : row.quote_amount)}
                    </Txt>
                  </View>
                ) : null}

                {row.admin_note ? (
                  <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
                    {row.admin_note}
                  </Txt>
                ) : null}

                {/* A card payment already in flight. Shown INSTEAD of the pay
                    button, and before the cancel row, so it is read before a
                    second charge is started for the same money. */}
                {awaiting ? (
                  <View style={s.awaiting}>
                    <Text style={s.awaitingLabel}>PAYMENT IN PROGRESS</Text>
                    <Txt tone="body" size={10.5} style={{ marginTop: 7, lineHeight: 16 }}>
                      We’ve sent you to the provider for {naira(row.quote_amount ?? 0)} and are
                      waiting to hear back. If you already paid, there is no need to pay again.
                    </Txt>
                  </View>
                ) : null}

                {quoted || cancellable || checkable ? (
                  <View style={s.actions}>
                    {checkable ? (
                      <Pressable
                        onPress={() => void checkPayment(row)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Check the payment on request ${row.ref}`}
                        style={({ pressed }) => [
                          s.action,
                          // The strong treatment only while it is the ONLY
                          // thing to do; once paying is offered again, that is
                          // the primary action and this is the quieter escape.
                          awaiting && s.actionStrong,
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <Text style={[s.actionText, awaiting && { color: "#FFFFFF" }]}>
                          {busy ? "Checking…" : "Check payment"}
                        </Text>
                      </Pressable>
                    ) : null}

                    {quoted && !awaiting ? (
                      <Pressable
                        onPress={() => {
                          setNotice(null);
                          setPaying(row);
                        }}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Accept and pay the quote of ${naira(row.quote_amount ?? 0)}`}
                        style={({ pressed }) => [s.action, s.actionStrong, pressed && { opacity: 0.75 }]}
                      >
                        <Text style={[s.actionText, { color: "#FFFFFF" }]}>Accept &amp; pay</Text>
                      </Pressable>
                    ) : null}

                    {cancellable ? (
                      <Pressable
                        onPress={() => void cancel(row)}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel request ${row.ref}`}
                        style={({ pressed }) => [s.action, pressed && { opacity: 0.75 }]}
                      >
                        <Text style={s.actionText}>{busy ? "Working…" : "Cancel"}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {quoted && !awaiting ? (
                  <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 13 }}>
                    Pay from your wallet or by card.{" "}
                    <Text
                      style={s.link}
                      onPress={() => router.push("/account/wallet-topup")}
                      accessibilityRole="link"
                    >
                      Top up
                    </Text>{" "}
                    if you’d rather use store credit.
                  </Txt>
                ) : null}

                {row.payment.method === "wallet" && row.amount_paid > 0 ? (
                  <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 13 }}>
                    Paid from your wallet.
                  </Txt>
                ) : row.payment.method && row.amount_paid > 0 ? (
                  <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 13 }}>
                    Paid by card · {row.payment.method === "paystack" ? "Paystack" : "Flutterwave"}.
                  </Txt>
                ) : null}
              </Panel>
            );
          })}
        </>
      ) : null}

      {/* The method choice lives on its own surface: it is the decision the
          customer came here to make, not a third button in a list row. */}
      <QuotePaySheet
        order={paying}
        open={paying !== null}
        onClose={() => setPaying(null)}
        onDone={paymentDone}
        bottomInset={insets.bottom}
      />
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  shot: {
    width: 96,
    height: 118,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },
  shotAdd: {
    backgroundColor: t.surfaces.stepperTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  shotAddText: { fontFamily: fonts.body, fontSize: 26, color: t.colors.primaryOn },
  shotX: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  shotXText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.ink },

  thumb: {
    width: 72,
    height: 86,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: t.colors.imgBg,
  },

  quote: {
    marginTop: 14,
    backgroundColor: t.surfaces.cart,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  /** A card payment we are still waiting on — warm, not alarming. */
  awaiting: {
    marginTop: 14,
    backgroundColor: t.surfaces.noteTint,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  awaitingLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.colors.gold2,
    includeFontPadding: false,
  },

  /**
   * A quoted request can offer three things at once — check an unanswered
   * payment, pay, cancel — and three pills do not fit across 375px. They wrap
   * instead, with a basis that keeps two on a line and lets a lone third grow
   * to fill its own.
   */
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  action: {
    flexGrow: 1,
    flexBasis: "45%",
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
  cancelText: { fontFamily: fonts.medium, fontSize: 11.5, color: t.textInk.body },

  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: t.surfaces.cart },
});
