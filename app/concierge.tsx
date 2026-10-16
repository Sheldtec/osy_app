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
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountHeader, Divide, Pill, SectionLabel, Thumb } from "@/components/account-ui";
import { IconSend } from "@/components/icons";
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
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { useStorefrontSettings } from "@/lib/settings";
import {
  loadSupportSession,
  pollSupport,
  saveSupportSession,
  sendSupport,
  startSupport,
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
 * MODE "live" is the human team, over the token-gated support endpoints. The
 * AI transcript is handed across on escalation, so the agent opens the thread
 * already knowing what was asked.
 *
 * Two things the server forces on this screen:
 *
 *   · A GUEST must give a name and an email before a conversation can be
 *     created (`SupportController::store` requires both when there is no
 *     account), so there is an inline form rather than a button that 422s.
 *   · The live thread is polled, not pushed. There is no socket on this API.
 */
const GUTTER = layout.gutter;
const POLL_MS = 4000;

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

export default function ConciergeScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, signedIn } = useAuth();
  const { settings } = useStorefrontSettings();

  const [mode, setMode] = useState<Mode>("bot");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- bot ---
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // --- live ---
  const [session, setSession] = useState<SupportSession | null>(null);
  const [liveMsgs, setLiveMsgs] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<SupportStatus>("waiting");
  const [agent, setAgent] = useState<string | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  const scroller = useRef<ScrollView>(null);
  const owner = user?.id ?? null;

  // ---- restore anything this account left behind ------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      const [saved, liveSession] = await Promise.all([
        loadTranscript(owner),
        loadSupportSession(owner),
      ]);
      if (!alive) return;

      setTurns(saved);
      if (liveSession) {
        setSession(liveSession);
        setMode("live");
      }
      setHydrated(true);
    })();

    return () => {
      alive = false;
    };
  }, [owner]);

  useEffect(() => {
    if (hydrated) void saveTranscript(turns, owner);
  }, [turns, owner, hydrated]);

  // ---- poll the live thread ---------------------------------------------
  const highest = useMemo(
    () => liveMsgs.reduce((max, m) => (m.id > max ? m.id : max), 0),
    [liveMsgs],
  );

  const pull = useCallback(async () => {
    if (!session) return;

    try {
      const res = await pollSupport(session, highest);
      setStatus(res.status);
      setAgent(res.agent);
      if (res.messages.length) {
        // `after` means the server only ever sends what we do not have, so
        // these are appended — but guard against a duplicate anyway, because
        // a retried request would otherwise double a message.
        setLiveMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.id));

          return [...prev, ...res.messages.filter((m) => !seen.has(m.id))];
        });
      }
    } catch (err) {
      // A closed or disowned conversation is permanent: stop polling and let
      // them start a new one, rather than retrying a 403 every four seconds.
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setSession(null);
        void saveSupportSession(null, owner);
        setError("That conversation is no longer available. Start a new one if you still need help.");
      }
    }
  }, [session, highest, owner]);

  useEffect(() => {
    if (!session || mode !== "live" || status === "closed") return;

    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);

    return () => clearInterval(timer);
  }, [session, mode, status, pull]);

  // Keep the newest message in view.
  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);

    return () => clearTimeout(t);
  }, [turns.length, liveMsgs.length, handingOver]);

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

    try {
      const res = await askConcierge(history);
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
    const content = text.trim().slice(0, 2000);
    if (!content || !session || busy) return;

    setDraft("");
    setError(null);
    setBusy(true);

    try {
      const msg = await sendSupport(session, content);
      setLiveMsgs((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That message did not send.");
      setDraft(content);
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    setError(null);

    if (!signedIn && (!guestName.trim() || !guestEmail.trim())) {
      setHandingOver(true);
      setError("Please give us a name and an email so the team can reply.");

      return;
    }

    setBusy(true);
    try {
      // The last thing they asked becomes the opening message; failing that,
      // a plain request. The AI turns ride along as context.
      const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content;
      const res = await startSupport({
        message: lastUser || "I’d like to speak to someone from the team, please.",
        subject: "Concierge handover (app)",
        transcript: turns.map((t) => ({ role: t.role, content: t.content })),
        ...(signedIn ? {} : { name: guestName, email: guestEmail }),
      });

      setSession(res.session);
      setLiveMsgs(res.messages);
      setStatus(res.status);
      setAgent(res.agent);
      setMode("live");
      setHandingOver(false);
      await saveSupportSession(res.session, owner);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We could not reach the team. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTurns([]);
    setError(null);
    void clearTranscript();
  }

  const contact = settings?.contact;
  const liveClosed = status === "closed";

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
              ? liveClosed
                ? "This conversation has been closed."
                : agent
                  ? `${agent} is with you${session ? ` · ${session.ref}` : ""}`
                  : `Waiting for an agent${session ? ` · ${session.ref}` : ""}`
              : "Ask about our hair, delivery or your order."
          }
          action={
            mode === "bot" && turns.length > 0
              ? { label: "Clear this chat", icon: <ClearGlyph />, onPress: reset }
              : undefined
          }
        />

        {mode === "live" ? (
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            <Pill
              label={liveClosed ? "Closed" : status === "live" ? "Live" : "Waiting"}
              tone={liveClosed ? "mute" : status === "live" ? "ok" : "warn"}
            />
          </View>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 18, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {mode === "bot" ? (
          <>
            <Bubble role="assistant" text={GREETING} />

            {turns.map((t) => (
              <View key={t.id}>
                <Bubble role={t.role} text={t.content} />

                {t.products?.length ? <Recommended products={t.products} /> : null}

                {t.handoff && !session ? (
                  <Pressable
                    onPress={() => void escalate()}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.handoff, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.handoffText}>Talk to the team</Text>
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
            {liveMsgs.map((m) => (
              <LiveBubble key={m.id} message={m} />
            ))}

            {liveClosed ? (
              <Pressable
                onPress={() => {
                  setSession(null);
                  setLiveMsgs([]);
                  setStatus("waiting");
                  setAgent(null);
                  setMode("bot");
                  void saveSupportSession(null, owner);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.handoff, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.handoffText}>Back to the concierge</Text>
              </Pressable>
            ) : null}
          </>
        )}

        {/* A guest has to be reachable before a thread can exist. */}
        {handingOver && !signedIn && !session ? (
          <View style={styles.panel}>
            <Txt tone="strong" size={13} weight="medium">
              How should the team reach you?
            </Txt>
            <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
              An agent may reply after you close the app, so we need somewhere to send it.
            </Txt>

            <GuestField
              label="NAME"
              value={guestName}
              onChangeText={setGuestName}
              placeholder="Your name"
              autoCapitalize="words"
            />
            <GuestField
              label="EMAIL"
              value={guestEmail}
              onChangeText={setGuestEmail}
              placeholder="you@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              onPress={() => void escalate()}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.handoff,
                { marginTop: 16 },
                (pressed || busy) && { opacity: 0.75 },
              ]}
            >
              <Text style={styles.handoffText}>
                {busy ? "Connecting…" : "Start the conversation"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.push({ pathname: "/auth", params: { mode: "signup" } })}
              accessibilityRole="button"
              style={{ paddingVertical: 12, alignItems: "center" }}
            >
              <Text style={styles.link}>Or sign in instead</Text>
            </Pressable>
          </View>
        ) : null}

        {busy && mode === "bot" ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
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

      {/* ---- composer ---- */}
      {!liveClosed ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={mode === "live" ? "Message the team…" : "Ask the concierge…"}
              placeholderTextColor={theme.textInk.faint}
              style={styles.input}
              multiline
              maxLength={MAX_CHARS}
              accessibilityLabel={mode === "live" ? "Message the team" : "Ask the concierge"}
              editable={!busy}
              onSubmitEditing={() => void (mode === "live" ? say(draft) : ask(draft))}
            />
          </View>

          <Pressable
            onPress={() => void (mode === "live" ? say(draft) : ask(draft))}
            disabled={busy || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy || draft.trim().length === 0 }}
            style={({ pressed }) => [
              styles.send,
              (busy || draft.trim().length === 0) && { opacity: 0.4 },
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

/** One side of the conversation. */
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
 * `system` turns are the server narrating ("escalated to the live team") and
 * `bot` turns are the AI history folded in on handover — neither is a person
 * speaking, so neither gets a speech bubble.
 */
function LiveBubble({ message }: { message: SupportMessage }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (message.sender === "system") {
    return (
      <Txt tone="body" size={9} center style={{ marginVertical: 10, lineHeight: 14 }}>
        {message.body}
      </Txt>
    );
  }

  const mine = message.sender === "customer";

  return (
    <View style={{ marginBottom: 2 }}>
      {!mine && message.author ? (
        <Text style={styles.author}>{message.author}</Text>
      ) : null}
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        <Text
          selectable
          style={[styles.bubbleText, mine ? { color: "#FFFFFF" } : { color: theme.colors.ink2 }]}
        >
          {message.body}
        </Text>
      </View>
    </View>
  );
}

/** Products the concierge named, priced by the server. */
function Recommended({ products }: { products: ConciergeProduct[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ gap: 8, marginBottom: 10 }}>
      {products.map((p) => {
        const onSale = p.sale_price > 0 && p.sale_price < p.price;

        return (
          <Pressable
            key={p.slug}
            onPress={() => router.push({ pathname: "/product/[slug]", params: { slug: p.slug } })}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${naira(onSale ? p.sale_price : p.price)}`}
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
                {naira(onSale ? p.sale_price : p.price)}
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
      <Text style={styles.guestLabel}>{label}</Text>
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
  bubbleText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },

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

  panel: { backgroundColor: t.colors.surface, borderRadius: 20, padding: 16, marginTop: 8 },
  guestLabel: {
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
  link: { fontFamily: fonts.medium, fontSize: 11.5, color: t.colors.primaryOn },

  thinking: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 },

  channel: {
    backgroundColor: t.colors.surface,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  channelText: { fontFamily: fonts.medium, fontSize: 11.5, color: t.colors.primaryOn },

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
