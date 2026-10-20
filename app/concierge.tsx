import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountHeader, Divide, SectionLabel, Thumb } from "@/components/account-ui";
import { IconClock, IconSend } from "@/components/icons";
import { Txt } from "@/components/ui";
import { resolveImage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  askConcierge,
  clearTranscript,
  loadTranscript,
  saveTranscript,
  MAX_CHARS,
  type ConciergeProduct,
  type ConciergeTurn,
  type StoredTurn,
} from "@/lib/concierge-api";
import { useApproxMoney, useCurrency } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import { useStorefrontSettings } from "@/lib/settings";
import {
  MAX_TRANSCRIPT,
  adoptGuestSupportSession,
  fetchSupportAvailability,
  loadSupportSession,
  pollSupport,
  saveSupportSession,
  sendSupport,
  startSupport,
  type SupportAvailability,
  type SupportMessage,
  type SupportSession,
  type SupportStatus,
} from "@/lib/support-api";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * Concierge — the shop's chat, in two modes.
 *
 * MODE "bot" talks to `POST /concierge`: Claude with a brand-locked prompt and
 * a live catalogue snapshot behind it, falling back to a scripted knowledge
 * base when the key is missing or the daily budget is spent. It can recommend
 * real products (priced by the server) and it can decide a human should take
 * over, which it signals with `handoff`.
 *
 * MODE "live" is the human team, over the token-gated support endpoints.
 *
 * ── What the handover has to get right ───────────────────────────────────
 *
 *  · NOBODY IS PROMISED WHO IS NOT THERE. "Talk to a person" is offered with
 *    measured presence beside it (`GET /support/availability`), because a
 *    control that queues a conversation into an empty room at 2am spends the
 *    customer's trust and gives nothing back — the failure `lib/oauth.ts` is
 *    written about. Offline the offer stays, and says so plainly.
 *
 *  · THE REPLY LANDS HERE AND NOWHERE ELSE. No notification, email or push is
 *    sent when an agent answers (there is no support entry in the server's
 *    notification catalogue), so nothing on this screen may imply one. What a
 *    guest's email buys is a human being able to follow up, and that is how it
 *    is worded.
 *
 *  · THE CONTEXT CROSSES OVER, VISIBLY. Six messages spent explaining a
 *    problem to the AI are handed to the agent, and the handover sheet lists
 *    exactly what goes — the chat, the name, the email, and nothing else —
 *    with a switch to hold the chat back. Nobody should discover after the
 *    fact what a stranger can read.
 *
 *  · A GUEST CAN START ONE. The server requires a name and an email from a
 *    visitor with no account, so the sheet asks for them inline rather than
 *    offering a button that 422s. Sign in later and the thread follows: see
 *    `adoptGuestSupportSession`, which is what the `claim` route exists for.
 *
 * ── Transport ────────────────────────────────────────────────────────────
 *
 * The live thread is POLLED, like the community room and the website; this API
 * has no socket. Three things that room learned the hard way are repeated
 * here, because they are the same problems: the send is OPTIMISTIC and a
 * refused one puts the text back in the composer; the list only follows the
 * newest message FOR A READER WHO IS ALREADY AT THE BOTTOM; and a failed poll
 * leaves what is on screen alone.
 */
const GUTTER = layout.gutter;
const POLL_MS = 4000;
/** Within this many points of the bottom still counts as "at the bottom". */
const AT_BOTTOM_SLOP = 90;
/** The server's ceiling on a support message (`SupportController::message`). */
const SUPPORT_MAX = 2000;

const GREETING =
  "Hello ✦ I’m the OsyGentle concierge. Ask me about our hair, delivery, the 30-day guarantee or your order — and if you’d rather speak to a person, I can connect you to the team.";

/**
 * Openers on a fresh chat.
 *
 * The first two are catalogue searches on purpose: the concierge queries live
 * stock through the shop's own parser, and nobody would guess it can do that
 * unless we show them.
 */
const QUICK_PROMPTS = [
  "Show me curly wigs under ₦100,000",
  'Do you have 18" bundles?',
  "Track my order",
  "Delivery times & fees",
];

type Mode = "bot" | "live";

/** A message the server has not confirmed yet. Negative ids never collide. */
type Local = SupportMessage & { pending?: boolean; failed?: boolean };

// ---------------------------------------------------------------------------
// Presence, put into words
// ---------------------------------------------------------------------------

/** How long ago, from a minutes-since count. */
function ago(minutes: number): string {
  if (minutes < 2) return "a moment ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "about an hour ago" : `about ${hours} hours ago`;

  const days = Math.round(hours / 24);

  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The reply time, or nothing.
 *
 * The server returns null below three answered conversations, because a time
 * quoted from one sample is a promise the shop has not earned. Zero is treated
 * the same way: a reply time we quote and miss costs more than one we never
 * quoted.
 */
function replyETA(p: SupportAvailability | null): string | null {
  const m = p?.typical_reply_minutes;
  if (!m || m <= 0) return null;
  if (m < 60) return `Usually answered in about ${m} minute${m === 1 ? "" : "s"}.`;

  const h = Math.round(m / 60);

  return `Usually answered in about ${h} hour${h === 1 ? "" : "s"}.`;
}

/** The same figure, short enough for the one-line bar. */
function replyShort(p: SupportAvailability | null): string | null {
  const m = p?.typical_reply_minutes;
  if (!m || m <= 0) return null;

  return m < 60 ? `usually ~${m} min` : `usually ~${Math.round(m / 60)} hr`;
}

/** One line for the handover bar: is there a person, yes or no. */
function presenceHeadline(p: SupportAvailability | null, checked: boolean): string {
  if (!p) return checked ? "We couldn’t check who’s on chat" : "Checking who’s on chat…";
  if (p.online) return "Someone is on chat now";

  return "No one is on chat right now";
}

export default function ConciergeScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, signedIn, loading: authLoading } = useAuth();
  const { settings } = useStorefrontSettings();
  // The concierge WRITES prices into its sentences, so it needs to know which
  // currency the shopper is reading in. Only the code is sent; the server
  // resolves the rate. What the shop charges is Naira either way.
  const { code: currency } = useCurrency();

  const [mode, setMode] = useState<Mode>("bot");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- bot ---
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  /**
   * Which account's saved chat is on screen, as the owner key it was read
   * under — not a bare boolean.
   *
   * A plain `hydrated` flag cannot survive someone signing in while this
   * screen is open: it stays true, the persist effect fires on the owner
   * change, and the GUEST's transcript is written to disk under the account
   * that just arrived. Comparing keys means the save waits for the load.
   */
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // --- presence ---
  const [presence, setPresence] = useState<SupportAvailability | null>(null);
  /** Distinguishes "not asked yet" from "asked, and could not find out". */
  const [presenceChecked, setPresenceChecked] = useState(false);

  // --- the handover sheet ---
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState("");
  const [shareChat, setShareChat] = useState(true);
  const [showShared, setShowShared] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [starting, setStarting] = useState(false);

  // --- live ---
  const [session, setSession] = useState<SupportSession | null>(null);
  const [liveMsgs, setLiveMsgs] = useState<SupportMessage[]>([]);
  /** Sent-but-unconfirmed bubbles, appended after the server's own messages. */
  const [outbox, setOutbox] = useState<Local[]>([]);
  const [status, setStatus] = useState<SupportStatus>("waiting");
  const [agent, setAgent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const scroller = useRef<ScrollView>(null);
  const owner = user?.id ?? null;
  const ownerKey = owner == null ? "guest" : String(owner);

  /**
   * The poll cursor, as a ref.
   *
   * It has to be read by the polling interval without being one of its
   * dependencies: derived from the message list instead, every arriving reply
   * would tear down and rebuild the timer, and a thread with an agent typing
   * steadily into it would be polled on a schedule that keeps restarting.
   */
  const cursor = useRef(0);
  /**
   * Whether the reader is parked at the newest message.
   *
   * A ref, not state: it is written from `onScroll` while the finger is still
   * moving, and routing that through a re-render would re-render the thread on
   * every frame of a drag.
   */
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  /** Replies that landed while the reader was scrolled away. */
  const [unseen, setUnseen] = useState(0);

  // ---- restore anything this account left behind ------------------------
  useEffect(() => {
    // WAIT for the stored session to be read. `user` is null for the first
    // frames of a cold start, so acting now would read both stores as the
    // GUEST — and both of them DELETE on an owner mismatch. That silently
    // threw away a signed-in shopper's concierge history and, worse, their
    // open support conversation, on every single launch.
    if (authLoading) return;

    let alive = true;

    (async () => {
      const saved = await loadTranscript(owner);
      // A conversation opened before signing in is claimed for the account
      // first, because the plain read below would discard it as somebody
      // else's. Only then fall back to one this account already owned.
      const live = owner != null
        ? ((await adoptGuestSupportSession(owner)) ?? (await loadSupportSession(owner)))
        : await loadSupportSession(owner);

      if (!alive) return;

      setTurns(saved);
      if (live) {
        setSession(live);
        setMode("live");
        // A restored session starts with nothing on screen, so the first poll
        // must ask for the thread from the beginning.
        cursor.current = 0;
        setLiveMsgs([]);
      }
      setHydratedFor(owner == null ? "guest" : String(owner));
    })();

    return () => {
      alive = false;
    };
  }, [authLoading, owner]);

  useEffect(() => {
    if (hydratedFor === ownerKey) void saveTranscript(turns, owner);
  }, [turns, owner, ownerKey, hydratedFor]);

  // ---- presence ---------------------------------------------------------
  const checkPresence = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSupportAvailability(signal);
      if (!signal?.aborted) setPresence(next);
    } catch {
      // Unknown is its own answer, and the copy says so rather than guessing
      // in either direction. A CANCELLED request is not unknown, though — the
      // screen is going away, and leaving "we couldn't check" behind would be
      // reporting our own teardown as a fact about the support desk.
      if (!signal?.aborted) setPresence(null);
    } finally {
      if (!signal?.aborted) setPresenceChecked(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkPresence(controller.signal);

    return () => controller.abort();
  }, [checkPresence]);

  // ---- the live thread ---------------------------------------------------
  /**
   * Add messages to the thread.
   *
   * `advanceCursor` is false by default and ONLY a poll passes true, because
   * only a poll has actually seen everything up to that id. It used to advance
   * unconditionally, and `say()` hands it the customer's OWN just-sent message
   * — so the cursor jumped past any agent reply with a lower id, and the server
   * filters strictly on `id > after`. Walked: the cursor sits at 49, the agent
   * replies as row 50, and within the same four-second window the customer
   * sends row 51; the cursor becomes 51, the next poll asks for `after=51`, and
   * row 50 is never fetched again. The customer was talking to somebody whose
   * answers silently never arrived.
   */
  const merge = useCallback((incoming: SupportMessage[], advanceCursor = false) => {
    if (!incoming.length) return;

    setLiveMsgs((prev) => {
      const seen = new Set(prev.map((m) => m.id));

      // `after` means the server only sends what we do not have, so these are
      // appended — but a retried request would otherwise double a message.
      return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
    });

    if (advanceCursor) {
      cursor.current = incoming.reduce((max, m) => (m.id > max ? m.id : max), cursor.current);
    }

    // Count only what arrived while the reader was elsewhere, and only what
    // somebody else said: your own message is why you are at the bottom.
    if (!atBottom.current) {
      const fresh = incoming.filter((m) => m.sender !== "customer").length;
      if (fresh > 0) setUnseen((n) => n + fresh);
    }
  }, []);

  const detach = useCallback(
    (message: string) => {
      setSession(null);
      setStatus("waiting");
      setAgent(null);
      setOutbox([]);
      void saveSupportSession(null, owner);
      setError(message);
    },
    [owner],
  );

  const pull = useCallback(
    async (signal?: AbortSignal) => {
      if (!session) return;

      try {
        const res = await pollSupport(session, cursor.current, signal);
        setStatus(res.status);
        setAgent(res.agent);
        // Sent on every poll while nothing has been answered, so a queue that
        // has quietly emptied out stops looking like a queue being worked.
        if (res.availability) {
          setPresence(res.availability);
          setPresenceChecked(true);
        }
        merge(res.messages, true);
      } catch (err) {
        if (!(err instanceof ApiError)) return;

        // A 403 covers TWO different things, and the difference decides whether
        // the conversation token survives. `reason` is the server's stable
        // discriminator (SupportController::refuse) — never the sentence, which
        // is copy and will be reworded.
        //
        //   · `signin` — the stored token is fine, the BEARER has expired. The
        //     app restores a cached profile at boot without revalidating, so a
        //     customer who leaves an unresolved thread for longer than the
        //     14-day token life lands here. Discarding the token destroyed
        //     their only copy of the conversation; it is now kept and they are
        //     asked to sign in again.
        //   · `token`, or a 404 — not theirs, or gone. Permanent, so stop
        //     polling rather than retrying every four seconds.
        //
        // Anything else — a dropped connection, a cancelled request — leaves the
        // screen alone, because one missed round trip is not news.
        if (err.status === 403 && err.reason === "signin") {
          setError("Please sign in again to carry on this conversation.");

          return;
        }
        if (err.status === 404 || (err.status === 403 && err.reason !== "signin")) {
          detach("That conversation is no longer available. Start a new one if you still need help.");
        }
      }
    },
    [session, merge, detach],
  );

  useEffect(() => {
    if (!session || mode !== "live" || status === "closed") return;

    const controller = new AbortController();
    void pull(controller.signal);
    const timer = setInterval(() => void pull(), POLL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [session, mode, status, pull]);

  const thread = useMemo<Local[]>(() => [...liveMsgs, ...outbox], [liveMsgs, outbox]);
  /** True once the handed-over concierge history is actually in the thread. */
  const sharedAI = useMemo(() => liveMsgs.some((m) => m.sender === "bot"), [liveMsgs]);

  const toBottom = useCallback((animated = true) => {
    scroller.current?.scrollToEnd({ animated });
    atBottom.current = true;
    setUnseen(0);
    setShowJump(false);
  }, []);

  // Follow the newest message, but ONLY for a reader who is already there.
  // Pinning unconditionally yanks the thread out from under anyone reading
  // back through it, every four seconds.
  const newest = thread.at(-1)?.id ?? turns.length;
  useEffect(() => {
    if (!atBottom.current) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 70);

    return () => clearTimeout(t);
  }, [newest, sheet]);

  // ---- sending ----------------------------------------------------------
  async function ask(text: string) {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || busy) return;

    setDraft("");
    setError(null);

    const mine: StoredTurn = { id: `u${Date.now()}`, role: "user", content };
    const history: ConciergeTurn[] = [...turns, mine].map((t) => ({
      role: t.role,
      content: t.content,
    }));

    setTurns((prev) => [...prev, mine]);
    setBusy(true);
    atBottom.current = true;

    try {
      const res = await askConcierge(history, currency);
      setTurns((prev) => [
        ...prev,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          content: res.reply,
          products: res.products,
          handoff: res.handoff,
        },
      ]);
    } catch (err) {
      // The question stays on screen so it can be retried without retyping;
      // it is the ANSWER that failed, and saying so beats a silent gap.
      setError(
        err instanceof ApiError
          ? err.message
          : "The concierge could not answer just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function say(text: string) {
    const body = text.trim().slice(0, SUPPORT_MAX);
    if (!body || !session || sending) return;

    // Optimistic bubble. A negative id cannot collide with a server row, and
    // `pending` is what draws the clock instead of nothing at all. Without it
    // the message you just sent is NOWHERE for the length of a round trip on a
    // Lagos connection — gone from the composer, not yet in the thread.
    const temp: Local = {
      id: -Date.now(),
      sender: "customer",
      type: "text",
      author: user?.name ?? null,
      body,
      at: new Date().toISOString(),
      pending: true,
    };

    setSending(true);
    setError(null);
    setDraft("");
    setOutbox((out) => [...out, temp]);
    atBottom.current = true;

    try {
      const msg = await sendSupport(session, body);
      // The server hands back the stored message, so the placeholder can be
      // swapped for the real row here instead of waiting for the next poll.
      setOutbox((out) => out.filter((o) => o.id !== temp.id));
      merge([msg]);
    } catch (err) {
      setOutbox((out) =>
        out.map((o) => (o.id === temp.id ? { ...o, pending: false, failed: true } : o)),
      );
      // Give the text back. Retyping a refused message is the insult on top of
      // the injury, and the refusal is usually about the CONVERSATION — closed
      // by the team while they were typing — not about the words.
      setDraft(body);
      setError(err instanceof ApiError ? err.message : "That message did not send.");
    } finally {
      setSending(false);
    }
  }

  // ---- handover ---------------------------------------------------------
  /** What would be handed over, trimmed to the server's own cap. */
  const sharedTurns = useMemo(() => turns.slice(-MAX_TRANSCRIPT), [turns]);

  function openSheet() {
    setError(null);
    // The last thing they asked is what a person most likely needs to read
    // first, so it is offered as the opening message — editable, because
    // sending it silently would hand the agent a question chosen for them.
    setNote((current) => current || [...turns].reverse().find((t) => t.role === "user")?.content || "");
    setSheet(true);
    // Asked again, every time. Presence that was true when the screen opened
    // is not presence: on a sheet opened twenty minutes later it is a stale
    // claim about whether a person is sitting there right now.
    void checkPresence();
  }

  async function escalate() {
    const message = note.trim();
    if (!message || starting) return;

    if (!signedIn && (!guestName.trim() || !guestEmail.trim())) {
      setError("Please add a name and an email so a person can follow up.");

      return;
    }

    setError(null);
    setStarting(true);

    try {
      const res = await startSupport({
        message,
        subject: "Concierge handover (app)",
        ...(shareChat && sharedTurns.length
          ? { transcript: sharedTurns.map((t) => ({ role: t.role, content: t.content })) }
          : {}),
        ...(signedIn ? {} : { name: guestName, email: guestEmail }),
      });

      setSession(res.session);
      cursor.current = res.messages.reduce((max, m) => (m.id > max ? m.id : max), 0);
      setLiveMsgs(res.messages);
      setOutbox([]);
      setStatus(res.status);
      setAgent(res.agent);
      if (res.availability) setPresence(res.availability);
      setMode("live");
      setSheet(false);
      setNote("");
      atBottom.current = true;
      await saveSupportSession(res.session, owner);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We could not reach the team. Please try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  function backToBot() {
    setSession(null);
    setLiveMsgs([]);
    setOutbox([]);
    cursor.current = 0;
    setStatus("waiting");
    setAgent(null);
    setError(null);
    setMode("bot");
    void saveSupportSession(null, owner);
  }

  function reset() {
    setTurns([]);
    setError(null);
    void clearTranscript();
  }

  const contact = settings?.contact;
  const liveClosed = status === "closed";
  const waiting = mode === "live" && Boolean(session) && status === "waiting";
  /**
   * The thread is over, either way it ended.
   *
   * `!session` in live mode is a conversation the server refused us — closed
   * and disowned, or claimed by another account — and it matters as much as a
   * tidy close, because what is left behind is a COMPOSER THAT CANNOT SEND.
   * A send with no session returned early and did nothing at all, which is
   * exactly the control-that-cannot-work this screen is supposed to avoid.
   */
  const liveEnded = mode === "live" && (liveClosed || !session);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.surfaces.cart }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: GUTTER }}>
        <AccountHeader
          title={mode === "live" ? "Our team" : "Concierge"}
          subtitle={
            mode === "live"
              ? !session
                ? "This conversation has ended."
                : liveClosed
                  ? "This conversation has been closed."
                  : agent
                    ? `${agent} is with you · ${session.ref}`
                    : `No one has answered yet · ${session.ref}`
              : "Ask about our hair, delivery or your order."
          }
          action={
            mode === "bot" && turns.length > 0
              ? { label: "Clear this chat", icon: <ClearGlyph />, onPress: reset }
              : undefined
          }
        />

        {mode === "live" ? (
          <>
            {session ? (
              <View style={{ flexDirection: "row", marginTop: 14 }}>
                <StatusChip status={status} />
              </View>
            ) : null}

            {/* Said once, where it cannot be missed: the agent is reading the
                concierge history too, not only what was typed to them. */}
            {sharedAI && !liveEnded ? (
              <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
                The team can read this whole thread, including the concierge chat you shared.
              </Txt>
            ) : null}
          </>
        ) : (
          <HandoverBar
            presence={presence}
            checked={presenceChecked}
            onPress={openSheet}
            open={sheet}
          />
        )}
      </View>

      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 18, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={64}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
            const was = atBottom.current;
            atBottom.current = distance <= AT_BOTTOM_SLOP;
            if (atBottom.current !== was) {
              setShowJump(!atBottom.current);
              if (atBottom.current) setUnseen(0);
            }
          }}
        >
          {mode === "bot" ? (
            <>
              <Bubble role="assistant" text={GREETING} />

              {turns.map((t) => (
                <View key={t.id}>
                  <Bubble role={t.role} text={t.content} />

                  {t.products?.length ? <Recommended products={t.products} /> : null}

                  {/* The AI itself decided a person should take this over. */}
                  {t.handoff && !session ? (
                    <Pressable
                      onPress={openSheet}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.handoff, pressed && { opacity: 0.75 }]}
                    >
                      <Text style={styles.handoffText}>Talk to a person</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {turns.length === 0 ? (
                <View style={{ marginTop: 6 }}>
                  <SectionLabel>TRY ASKING</SectionLabel>
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {QUICK_PROMPTS.map((q) => (
                      <Pressable
                        key={q}
                        onPress={() => void ask(q)}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.prompt, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.promptText}>{q}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <>
              {thread.map((m) => (
                <LiveBubble key={m.id} message={m} />
              ))}

              {/* An unanswered conversation must not look answered. */}
              {waiting ? <WaitingCard presence={presence} /> : null}

              {liveEnded ? (
                <View style={styles.panel}>
                  <Txt tone="strong" size={13} weight="medium">
                    {session ? "The team closed this conversation" : "This conversation has ended"}
                  </Txt>
                  <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                    {session
                      ? "You can read it here for as long as you like. If something is still unresolved, start a new one and the whole thread stays on our side."
                      : "It can’t be continued from this device any more. Start a new one if you still need help — the team keeps the whole history on their side."}
                  </Txt>
                  <Pressable
                    onPress={backToBot}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.handoff,
                      { marginTop: 14, marginBottom: 0 },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Text style={styles.handoffText}>Back to the concierge</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}

          {/* ---- the handover sheet ---- */}
          {sheet && !session ? (
            <HandoverSheet
              presence={presence}
              checked={presenceChecked}
              signedIn={signedIn}
              accountName={user?.name ?? null}
              accountEmail={user?.email ?? null}
              note={note}
              onNote={setNote}
              shareChat={shareChat}
              onShareChat={setShareChat}
              sharedTurns={sharedTurns}
              showShared={showShared}
              onToggleShared={() => setShowShared((v) => !v)}
              guestName={guestName}
              onGuestName={setGuestName}
              guestEmail={guestEmail}
              onGuestEmail={setGuestEmail}
              busy={starting}
              onStart={() => void escalate()}
              onCancel={() => setSheet(false)}
            />
          ) : null}

          {busy && mode === "bot" ? (
            <View style={styles.thinking}>
              <ActivityIndicator size="small" color={theme.colors.primaryOn} />
              <Txt tone="body" size={10}>
                Looking that up…
              </Txt>
            </View>
          ) : null}

          {error ? (
            <Txt tone="danger" size={11} style={{ marginTop: 12, lineHeight: 16 }}>
              {error}
            </Txt>
          ) : null}

          {/* Only the channels this shop has actually filled in. A call button
              on a shop with no number is a control that cannot work. */}
          {mode === "bot" && (contact?.whatsapp || contact?.phone || contact?.email) ? (
            <View style={{ marginTop: 22 }}>
              <Divide />
              <SectionLabel>OR REACH US DIRECTLY</SectionLabel>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {contact.whatsapp ? (
                  <Channel
                    label="WhatsApp"
                    url={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, "")}`}
                  />
                ) : null}
                {contact.phone ? <Channel label="Call" url={`tel:${contact.phone}`} /> : null}
                {contact.email ? <Channel label="Email" url={`mailto:${contact.email}`} /> : null}
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* ---- jump to the newest, with what you have missed ---- */}
        {showJump ? (
          <Pressable
            onPress={() => toBottom()}
            accessibilityRole="button"
            accessibilityLabel={
              unseen > 0 ? `${unseen} new replies. Jump to the latest.` : "Jump to the latest"
            }
            style={({ pressed }) => [styles.jump, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.jumpChevron}>⌄</Text>
            {unseen > 0 ? (
              <View style={styles.jumpBadge}>
                <Text style={styles.jumpBadgeText}>{unseen > 99 ? "99+" : unseen}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {/* ---- composer ---- */}
      {!liveEnded ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={mode === "live" ? "Message the team…" : "Ask the concierge…"}
              placeholderTextColor={theme.textInk.faint}
              style={styles.input}
              multiline
              maxLength={mode === "live" ? SUPPORT_MAX : MAX_CHARS}
              accessibilityLabel={mode === "live" ? "Message the team" : "Ask the concierge"}
              editable={mode === "live" || !busy}
              onSubmitEditing={() => void (mode === "live" ? say(draft) : ask(draft))}
            />
          </View>

          <Pressable
            onPress={() => void (mode === "live" ? say(draft) : ask(draft))}
            disabled={busy || sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy || sending || draft.trim().length === 0 }}
            style={({ pressed }) => [
              styles.send,
              (busy || sending || draft.trim().length === 0) && { opacity: 0.4 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <IconSend width={20} height={20} />
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------

/**
 * The way to a person, always in reach.
 *
 * It used to appear only on a turn where the AI had set `handoff`, which meant
 * a shopper the bot was cheerfully failing had no visible way out. It carries
 * the presence state because the answer to "can I talk to someone" is mostly
 * "is anyone there", and that is worth knowing before the tap, not after.
 */
function HandoverBar({
  presence,
  checked,
  onPress,
  open,
}: {
  presence: SupportAvailability | null;
  checked: boolean;
  onPress: () => void;
  open: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = presence?.online ?? false;

  const sub = !presence
    ? checked
      ? "you can still leave a message for the team"
      : "one moment…"
    : online
      ? (replyShort(presence) ?? "the support desk is open")
      : presence.last_seen_minutes != null
        ? `last on chat ${ago(presence.last_seen_minutes)}`
        : "leave a message and the team will pick it up";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Talk to a person. ${presenceHeadline(presence, checked)}.`}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [styles.bar, pressed && { opacity: 0.8 }]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: online ? theme.colors.success : theme.surfaces.handle },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Txt tone="strong" size={12} weight="medium">
          Talk to a person
        </Txt>
        <Txt tone="body" size={10} style={{ marginTop: 3 }} numberOfLines={1}>
          {presenceHeadline(presence, checked)} · {sub}
        </Txt>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

/**
 * The handover itself: what is true about the queue, and what crosses over.
 *
 * Both halves are the point. A shopper who taps "talk to a person" at 2am is
 * owed the fact that nobody is there BEFORE they wait, and a shopper whose six
 * messages are about to be read by a stranger is owed the list of what that
 * stranger will see — with a way to say no to it.
 */
function HandoverSheet({
  presence,
  checked,
  signedIn,
  accountName,
  accountEmail,
  note,
  onNote,
  shareChat,
  onShareChat,
  sharedTurns,
  showShared,
  onToggleShared,
  guestName,
  onGuestName,
  guestEmail,
  onGuestEmail,
  busy,
  onStart,
  onCancel,
}: {
  presence: SupportAvailability | null;
  checked: boolean;
  signedIn: boolean;
  accountName: string | null;
  accountEmail: string | null;
  note: string;
  onNote: (v: string) => void;
  shareChat: boolean;
  onShareChat: (v: boolean) => void;
  sharedTurns: StoredTurn[];
  showShared: boolean;
  onToggleShared: () => void;
  guestName: string;
  onGuestName: (v: string) => void;
  guestEmail: string;
  onGuestEmail: (v: string) => void;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = presence?.online ?? false;
  const eta = replyETA(presence);
  const ready = note.trim().length > 0 && (signedIn || (guestName.trim() && guestEmail.trim()));

  return (
    <View style={styles.panel}>
      <Txt tone="strong" size={14} weight="medium">
        Talk to a person
      </Txt>

      {/* ---- what is actually true about the queue ---- */}
      <View style={styles.presenceBlock}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={[
              styles.dot,
              { backgroundColor: online ? theme.colors.success : theme.surfaces.handle },
            ]}
          />
          <Txt tone="strong" size={12} weight="medium">
            {presenceHeadline(presence, checked)}
          </Txt>
        </View>

        <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
          {!presence
            ? // Neither claim can be made honestly, so neither is made.
              "We couldn’t reach the support desk to see who is on. You can still start the conversation — it will be waiting for the team either way."
            : online
              ? (eta ?? "Someone will pick this up shortly.")
              : presence.last_seen_minutes != null
                ? `The support desk was last open ${ago(presence.last_seen_minutes)}. Start the conversation anyway — it waits in the queue, and the team picks it up when they are back.`
                : "Start the conversation anyway — it waits in the queue until the team is next on chat."}
        </Txt>

        {presence && presence.waiting > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <IconClock width={13} height={13} color={theme.textInk.faint} />
            <Txt tone="faint" size={10}>
              {presence.waiting} conversation{presence.waiting === 1 ? "" : "s"} ahead of yours
            </Txt>
          </View>
        ) : null}

        {/* No email, push or SMS is sent when an agent answers, so this is the
            only place the reply appears. Said plainly rather than discovered. */}
        <Txt tone="faint" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
          The reply arrives in this chat — nothing is emailed automatically, so check back here.
        </Txt>
      </View>

      {/* ---- the opening message ---- */}
      <Text style={styles.fieldLabel}>WHAT DO YOU NEED HELP WITH?</Text>
      <TextInput
        value={note}
        onChangeText={onNote}
        placeholder="Tell the team in a line or two…"
        placeholderTextColor={theme.textInk.faint}
        style={[styles.guestInput, styles.noteInput]}
        multiline
        maxLength={SUPPORT_MAX}
        accessibilityLabel="What do you need help with?"
      />

      {/* ---- what the agent will be able to read ---- */}
      <Text style={[styles.fieldLabel, { marginTop: 18 }]}>WHAT THE TEAM WILL SEE</Text>

      {sharedTurns.length > 0 ? (
        <View style={styles.shareRow}>
          <View style={{ flex: 1 }}>
            <Txt tone="strong" size={11.5} weight="medium">
              This chat
            </Txt>
            <Txt tone="body" size={10} style={{ marginTop: 3, lineHeight: 14 }}>
              {sharedTurns.length} message{sharedTurns.length === 1 ? "" : "s"} with the concierge,
              so you don’t have to explain it twice.
            </Txt>
            <Pressable onPress={onToggleShared} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.link}>{showShared ? "Hide it" : "Show me what’s shared"}</Text>
            </Pressable>
          </View>
          <Switch
            value={shareChat}
            onValueChange={onShareChat}
            trackColor={{ false: theme.surfaces.lineSoft, true: theme.colors.primary }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Share this chat with the team"
          />
        </View>
      ) : (
        <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
          Nothing from this chat yet — only the message above.
        </Txt>
      )}

      {showShared && sharedTurns.length > 0 ? (
        <View style={[styles.transcript, !shareChat && { opacity: 0.45 }]}>
          {sharedTurns.map((t) => (
            <Txt key={t.id} tone="body" size={10} numberOfLines={3} style={{ lineHeight: 15 }}>
              <Text style={styles.who}>{t.role === "user" ? "You · " : "Concierge · "}</Text>
              {t.content}
            </Txt>
          ))}
        </View>
      ) : null}

      {/* Precise about the THREAD, not about the shop. The agent sees the
          account the conversation is attached to; they can look an order up in
          their own console as they always could, and nothing else from this
          app is sent along. */}
      <Txt tone="faint" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
        {signedIn
          ? `The account this is sent from — ${accountName ?? "your account"}${accountEmail ? ` · ${accountEmail}` : ""}. Nothing else from the app is attached.`
          : "Your name and email, below. Nothing else from the app is attached."}
      </Txt>

      {/* ---- a guest has to be reachable before a thread can exist ---- */}
      {!signedIn ? (
        <>
          <GuestField
            label="NAME"
            value={guestName}
            onChangeText={onGuestName}
            placeholder="Your name"
            autoCapitalize="words"
          />
          <GuestField
            label="EMAIL"
            value={guestEmail}
            onChangeText={onGuestEmail}
            placeholder="you@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Txt tone="faint" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
            The team sees these with your message, so a person can follow up if you have closed the
            app. Sign in later and this conversation follows you.
          </Txt>
        </>
      ) : null}

      <Pressable
        onPress={onStart}
        disabled={busy || !ready}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !ready }}
        style={({ pressed }) => [
          styles.start,
          (busy || !ready) && { opacity: 0.45 },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.startText}>{busy ? "Connecting…" : "Start the conversation"}</Text>
      </Pressable>

      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        style={{ paddingVertical: 12, alignItems: "center" }}
      >
        <Text style={styles.link}>Keep talking to the concierge</Text>
      </Pressable>
    </View>
  );
}

/**
 * Nobody has answered yet, and the card says so in those words.
 *
 * The one state a chat must never fake. Its numbers come from the same poll
 * that fetches the messages, so a desk that closes while somebody waits is
 * reflected within four seconds rather than at the next launch.
 */
function WaitingCard({ presence }: { presence: SupportAvailability | null }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = presence?.online ?? false;
  const eta = replyETA(presence);
  // The snapshot counts every waiting conversation, THIS ONE INCLUDED, so the
  // queue ahead is one fewer. Printing the raw number would tell the only
  // person in the queue that somebody is in front of them.
  const ahead = Math.max(0, (presence?.waiting ?? 1) - 1);

  return (
    <View style={styles.waitCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={[
            styles.dot,
            { backgroundColor: online ? theme.colors.success : theme.surfaces.handle },
          ]}
        />
        <Txt tone="strong" size={12} weight="medium">
          {online ? "Waiting for the team" : "No one is on chat right now"}
        </Txt>
      </View>

      <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 15 }}>
        {online
          ? (eta ?? "Your message is in the queue.")
          : presence?.last_seen_minutes != null
            ? `Your message is saved and waiting. The support desk was last open ${ago(presence.last_seen_minutes)}.`
            : "Your message is saved and waiting for the next person on chat."}
      </Txt>

      {ahead > 0 ? (
        <Txt tone="faint" size={10} style={{ marginTop: 6 }}>
          {ahead} conversation{ahead === 1 ? "" : "s"} ahead of yours.
        </Txt>
      ) : null}

      <Txt tone="faint" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
        You can keep typing — everything you add stays in this thread.
      </Txt>
    </View>
  );
}

/** Waiting · live · closed, with the dot doing the work. */
function StatusChip({ status }: { status: SupportStatus }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const palette =
    status === "live"
      ? { bg: theme.colors.successBg, fg: theme.colors.success, label: "LIVE" }
      : status === "waiting"
        ? { bg: theme.surfaces.noteTint, fg: theme.colors.gold2, label: "WAITING" }
        : // `primaryOn`, not `primary`: this is purple being READ, and brand
          // purple on the dark theme's tint is about 1.6:1.
          { bg: theme.surfaces.verifiedTint, fg: theme.colors.primaryOn, label: "CLOSED" };

  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.chipText, { color: palette.fg }]}>{palette.label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

/** One side of the concierge conversation. */
function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const mine = role === "user";

  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      <Text
        selectable
        style={[
          styles.bubbleText,
          mine ? { color: "#FFFFFF" } : { color: theme.colors.ink2 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * A live-thread message.
 *
 * Four senders arrive here and only two of them are people. `system` turns are
 * the server narrating ("escalated to the live support team"), so they get a
 * centred caption rather than a bubble. `bot` turns are the AI history folded
 * in on handover, and they are DELIBERATELY MARKED: once the concierge and the
 * agent both sit on the left in the same tint, nobody can tell whether a
 * promise was made by a person or by a machine. The website makes the same
 * distinction with a dashed gold frame, for the same reason.
 *
 * Agents can send an image or a product card as well as text (see
 * `replyImage` / `replyProduct`), and both used to render as an empty bubble.
 */
function LiveBubble({ message: m }: { message: Local }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (m.sender === "system") {
    return (
      <Txt tone="body" size={9} center style={{ marginVertical: 10, lineHeight: 14 }}>
        {m.body}
      </Txt>
    );
  }

  const mine = m.sender === "customer";
  const isBot = m.sender === "bot";
  const label = mine ? null : isBot ? "Concierge (AI)" : m.author || "Support";
  const image = m.type === "image" ? resolveImage(m.meta?.url) : null;

  return (
    <View style={{ marginBottom: 2 }}>
      {label ? (
        <Text style={[styles.author, isBot && { color: theme.colors.gold2 }]}>{label}</Text>
      ) : null}

      {m.type === "product" && m.meta?.slug ? (
        <>
          {m.body ? (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text
                selectable
                style={[styles.bubbleText, mine ? { color: "#FFFFFF" } : { color: theme.colors.ink2 }]}
              >
                {m.body}
              </Text>
            </View>
          ) : null}
          <LiveProduct meta={m.meta} />
        </>
      ) : (
        <View
          style={[
            styles.bubble,
            mine ? styles.mine : styles.theirs,
            isBot && styles.aiBubble,
            m.failed && styles.failedBubble,
            Boolean(image) && { padding: 5 },
          ]}
        >
          {image ? (
            <Pressable
              // Opens full size in the browser. Cloudinary serves the original
              // at this URL, which beats a lightbox that cannot zoom.
              onPress={() => void Linking.openURL(image).catch(() => {})}
              accessibilityRole="imagebutton"
              accessibilityLabel={m.body || "Photo from the team"}
            >
              <Image
                source={{ uri: image }}
                style={styles.photo}
                contentFit="cover"
                transition={120}
              />
            </Pressable>
          ) : null}

          {m.body ? (
            <Text
              selectable
              style={[
                styles.bubbleText,
                mine ? { color: "#FFFFFF" } : { color: theme.colors.ink2 },
                Boolean(image) && { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 3 },
              ]}
            >
              {m.body}
            </Text>
          ) : null}
        </View>
      )}

      {/* Sent, not yet acknowledged — or refused, and the text is back in the
          composer waiting to be tried again. */}
      {m.pending || m.failed ? (
        <Text style={[styles.receipt, m.failed && { color: theme.colors.danger }]}>
          {m.failed ? "Not sent" : "Sending…"}
        </Text>
      ) : null}
    </View>
  );
}

/** A product an agent put in the thread, priced by the server when they sent it. */
function LiveProduct({ meta }: { meta: NonNullable<SupportMessage["meta"]> }) {
  const styles = useThemedStyles(makeStyles);
  const money = useApproxMoney();
  const price = meta.price ?? 0;
  const sale = meta.sale_price ?? null;
  const onSale = sale != null && sale > 0 && sale < price;

  return (
    <Pressable
      onPress={() =>
        meta.slug
          ? router.push({ pathname: "/product/[slug]", params: { slug: meta.slug } })
          : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={`${meta.name ?? "Product"}, ${money(onSale ? sale! : price)}`}
      style={({ pressed }) => [styles.rec, { marginBottom: 10 }, pressed && { opacity: 0.8 }]}
    >
      <Thumb
        src={resolveImage(meta.image)}
        seed={meta.slug ?? "product"}
        alt={meta.name ?? "Product"}
        width={48}
        height={56}
      />
      <View style={{ flex: 1 }}>
        <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 15 }}>
          {meta.name ?? "Product"}
        </Txt>
        {meta.spec ? (
          <Txt tone="body" size={9} numberOfLines={1} style={{ marginTop: 3 }}>
            {meta.spec}
          </Txt>
        ) : null}
        <Txt tone="strong" display size={14} style={{ marginTop: 4 }}>
          {money(onSale ? sale! : price)}
        </Txt>
      </View>
    </Pressable>
  );
}

/** Products the concierge named, priced by the server. */
function Recommended({ products }: { products: ConciergeProduct[] }) {
  const styles = useThemedStyles(makeStyles);
  const money = useApproxMoney();
  return (
    <View style={{ gap: 8, marginBottom: 10 }}>
      {products.map((p) => {
        const onSale = p.sale_price > 0 && p.sale_price < p.price;

        return (
          <Pressable
            key={p.slug}
            onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: p.slug } })}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${money(onSale ? p.sale_price : p.price)}`}
            style={({ pressed }) => [styles.rec, pressed && { opacity: 0.8 }]}
          >
            <Thumb src={resolveImage(p.image)} seed={p.slug} alt={p.name} width={48} height={56} />
            <View style={{ flex: 1 }}>
              <Txt tone="strong" size={11} numberOfLines={2} style={{ lineHeight: 15 }}>
                {p.name}
              </Txt>
              {p.spec ? (
                <Txt tone="body" size={9} numberOfLines={1} style={{ marginTop: 3 }}>
                  {p.spec}
                </Txt>
              ) : null}
              <Txt tone="strong" display size={14} style={{ marginTop: 4 }}>
                {money(onSale ? p.sale_price : p.price)}
              </Txt>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Channel({ label, url }: { label: string; url: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.channel, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.channelText}>{label}</Text>
    </Pressable>
  );
}

function GuestField({
  label,
  ...input
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={theme.textInk.faint}
        accessibilityLabel={label}
        style={styles.guestInput}
      />
    </View>
  );
}

/** A plain ✕, so clearing the chat does not need a new asset. */
function ClearGlyph() {
  const theme = useTheme();
  return <Text style={{ fontFamily: fonts.medium, fontSize: 17, color: theme.textInk.body }}>✕</Text>;
}

const makeStyles = (t: Theme) => StyleSheet.create({
  bubble: {
    maxWidth: "86%",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 10,
  },
  // Borderless on the tinted ground — the account area's language, not the
  // checkout's hairline-bordered one.
  theirs: { alignSelf: "flex-start", backgroundColor: t.colors.surface },
  mine: { alignSelf: "flex-end", backgroundColor: t.colors.primary },
  // The handed-over AI history, marked as such: a warm tint and a gold hairline
  // on an otherwise borderless surface.
  aiBubble: {
    backgroundColor: t.surfaces.noteTint,
    borderWidth: 1,
    borderColor: t.colors.gold2,
  },
  failedBubble: { borderWidth: 1, borderColor: t.colors.danger },
  bubbleText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  photo: { width: 220, height: 220, borderRadius: 16, backgroundColor: t.colors.imgBg },
  receipt: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: t.textInk.faint,
    alignSelf: "flex-end",
    marginTop: -6,
    marginBottom: 10,
    marginRight: 4,
  },

  author: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: t.textInk.faint,
    marginBottom: 5,
    marginLeft: 4,
  },

  rec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    padding: 10,
  },

  prompt: {
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  promptText: { fontFamily: fonts.body, fontSize: 12, color: t.colors.ink2 },

  handoff: {
    alignSelf: "flex-start",
    backgroundColor: t.colors.primaryCont,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginBottom: 12,
  },
  handoffText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chev: { fontFamily: fonts.body, fontSize: 20, color: t.textInk.faint, marginTop: -2 },

  chip: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.1 },

  panel: { backgroundColor: t.colors.surface, borderRadius: 20, padding: 16, marginTop: 8 },
  presenceBlock: {
    backgroundColor: t.surfaces.cart,
    borderRadius: 16,
    padding: 13,
    marginTop: 12,
    marginBottom: 18,
  },
  waitCard: {
    backgroundColor: t.colors.surface,
    borderRadius: 20,
    padding: 15,
    marginTop: 6,
    marginBottom: 8,
  },

  shareRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  transcript: {
    gap: 7,
    backgroundColor: t.surfaces.cart,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  who: { fontFamily: fonts.medium, color: t.textInk.faint },

  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
  },
  guestInput: {
    marginTop: 6,
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: t.surfaces.cart,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: t.colors.ink,
  },
  noteInput: {
    height: undefined,
    minHeight: 72,
    maxHeight: 140,
    paddingTop: 12,
    paddingBottom: 12,
    lineHeight: 19,
  },
  link: { fontFamily: fonts.medium, fontSize: 11.5, color: t.colors.primaryOn, marginTop: 7 },

  start: {
    backgroundColor: t.colors.primary,
    borderRadius: 20,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 18,
  },
  startText: { fontFamily: fonts.medium, fontSize: 13, color: "#FFFFFF" },

  thinking: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 },

  channel: {
    backgroundColor: t.colors.surface,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  channelText: { fontFamily: fonts.medium, fontSize: 11.5, color: t.colors.primaryOn },

  jump: {
    position: "absolute",
    right: GUTTER,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpChevron: {
    fontFamily: fonts.body,
    fontSize: 20,
    lineHeight: 22,
    color: t.textInk.body,
    marginTop: -2,
  },
  jumpBadge: {
    position: "absolute",
    top: -5,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpBadgeText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: "#FFFFFF",
    includeFontPadding: false,
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: GUTTER,
    paddingTop: 10,
    backgroundColor: t.surfaces.cart,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: t.colors.surface,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 4,
    justifyContent: "center",
    minHeight: 46,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: t.colors.ink,
    maxHeight: 110,
    paddingTop: Platform.OS === "ios" ? 12 : 8,
    paddingBottom: Platform.OS === "ios" ? 12 : 8,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
});
