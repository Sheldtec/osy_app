import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CommunityActions } from "@/components/community-actions";
import { CommunityMessageRow } from "@/components/community-message";
import { IconBackChevron, IconReply, IconSend } from "@/components/icons";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  CommunityError,
  MESSAGE_MAX,
  deleteCommunityMessage,
  fetchCommunityFeed,
  likeCommunityMessage,
  sendCommunityMessage,
  type CommunityFeed,
  type CommunityMessage,
} from "@/lib/community";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts, layout } from "@/theme/tokens";

/**
 * The community room.
 *
 * Polled rather than pushed, every few seconds, matching the website. A socket
 * would be nicer and is not worth a second transport for a room this size.
 *
 * Reading does not need an account — someone deciding whether to join should be
 * able to see what they would be joining. Posting does, and the server also
 * enforces the room lock and per-member mutes; this screen reports what the
 * server says rather than trying to predict it.
 *
 * Four things here are load-bearing, and each replaced something that was
 * quietly wrong:
 *
 *  · THE SEND IS OPTIMISTIC. It used to await the POST and only then clear the
 *    input, so for the length of a round trip on a Lagos connection the message
 *    you just sent was nowhere — still sitting in the box, with no bubble. Now
 *    the bubble appears instantly with a clock on it, and is replaced by the
 *    server's own row. A refused send turns that bubble red and PUTS THE TEXT
 *    BACK in the composer, because the one thing worse than a failed message is
 *    a failed message you have to retype.
 *
 *  · THE COMPOSER IS NOT ABSOLUTELY POSITIONED ANY MORE. It was
 *    `position: absolute` inside a `KeyboardAvoidingView`, and KAV works by
 *    padding its own box — which cannot move an absolute child. The composer
 *    therefore sat under the keyboard on both platforms. It is now a flex
 *    sibling of the list inside the KAV, which is the arrangement that actually
 *    lifts.
 *
 *  · REPLIES ARE REACHABLE. `reply_to_id` has been accepted by the server from
 *    the start and bubbles already rendered the quote, but nothing in the app
 *    could create one. Swipe a bubble right, or hold it.
 *
 *  · THE LIST ONLY AUTOSCROLLS WHEN YOU ARE AT THE BOTTOM. Pinning to the
 *    newest message unconditionally yanks the room out from under anyone
 *    reading back through it, every four seconds. Scrolled up, a pill appears
 *    with the number of messages that have landed since.
 */

const POLL_MS = 4000;
const GUTTER = layout.gutter;
/** Messages this far apart start a new run even from the same person. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Within this many points of the bottom still counts as "at the bottom". */
const AT_BOTTOM_SLOP = 90;

/** A message the server has not confirmed yet. Negative ids never collide. */
type Local = CommunityMessage & { pending?: boolean; failed?: boolean };

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; message: Local; first: boolean; last: boolean };

function dayLabel(d: Date): string {
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);

  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Flatten the feed into day separators and grouped message rows. */
function buildRows(messages: Local[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";

  messages.forEach((m, i) => {
    const at = m.at ? new Date(m.at) : null;
    const day = at && !Number.isNaN(at.getTime()) ? dayLabel(at) : "";

    if (day && day !== lastDay) {
      rows.push({ kind: "day", key: `day-${day}-${m.id}`, label: day });
      lastDay = day;
    }

    const prev = messages[i - 1];
    const next = messages[i + 1];
    const near = (a?: Local, b?: Local) => {
      if (!a?.at || !b?.at) return false;

      return Math.abs(new Date(b.at).getTime() - new Date(a.at).getTime()) < GROUP_WINDOW_MS;
    };

    // A day separator always starts a fresh run, or the first bubble under it
    // would lose its name.
    const sameRunAsPrev =
      Boolean(prev) &&
      prev.user_id === m.user_id &&
      near(prev, m) &&
      rows[rows.length - 1]?.kind !== "day";
    const sameRunAsNext = Boolean(next) && next.user_id === m.user_id && near(m, next);

    rows.push({
      kind: "msg",
      key: String(m.id),
      message: m,
      first: !sameRunAsPrev,
      last: !sameRunAsNext,
    });
  });

  return rows;
}

export default function CommunityScreen() {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [feed, setFeed] = useState<CommunityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  /** Sent-but-unconfirmed bubbles, appended after the server's own messages. */
  const [outbox, setOutbox] = useState<Local[]>([]);
  /** The message being replied to, quoted above the composer. */
  const [replyTo, setReplyTo] = useState<CommunityMessage | null>(null);
  /** The message whose action sheet is open. */
  const [acting, setActing] = useState<CommunityMessage | null>(null);

  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  /**
   * Whether the reader is parked at the newest message.
   *
   * A ref, not state: it is written from `onScroll` on every frame and read by
   * the poll's effect, and routing that through a re-render would re-render the
   * whole list while the finger is still moving.
   */
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  /** Messages that landed while the reader was scrolled away. */
  const [unseen, setUnseen] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchCommunityFeed(signal);
      if (data) {
        setFeed((prev) => {
          // Count only what arrived while the reader was elsewhere, and only
          // other people's: your own message is why you are at the bottom.
          if (prev && !atBottom.current) {
            const before = prev.messages.at(-1)?.id ?? 0;
            const fresh = data.messages.filter((m) => m.id > before && !m.mine).length;
            if (fresh > 0) setUnseen((n) => n + fresh);
          }

          return data;
        });
        // Anything the server has now acknowledged can leave the outbox.
        setOutbox((out) =>
          out.filter((o) => o.failed || !data.messages.some((m) => m.mine && m.body === o.body)),
        );
        setError(null);
      }
    } catch (e) {
      // A failed poll must not wipe the messages already on screen — it just
      // means this one round trip missed.
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof CommunityError ? e.message : "Couldn't reach the room.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(), POLL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const messages = useMemo<Local[]>(
    () => [...(feed?.messages ?? []), ...outbox],
    [feed?.messages, outbox],
  );
  const rows = useMemo(() => buildRows(messages), [messages]);

  const toBottom = useCallback((animated = true) => {
    // An offset past the end is clamped, so overshooting is free — and it is
    // the only option when the row has not been laid out yet.
    listRef.current?.scrollToOffset({ offset: Number.MAX_SAFE_INTEGER, animated });
    atBottom.current = true;
    setUnseen(0);
    setShowJump(false);
  }, []);

  // Follow the newest message, but ONLY for a reader who is already there.
  const newestKey = messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (newestKey === null || !atBottom.current) return;
    const t = setTimeout(() => toBottom(false), 60);

    return () => clearTimeout(t);
  }, [newestKey, toBottom]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    const quoted = replyTo;
    // Optimistic bubble. A negative id cannot collide with a server row, and
    // `pending` is what draws the clock instead of the sent tick.
    const temp: Local = {
      id: -Date.now(),
      user_id: user?.id ?? null,
      name: user?.name ?? "You",
      avatar: user?.avatar ?? null,
      team: false,
      mine: true,
      type: "text",
      body,
      product: null,
      reply: quoted ? { id: quoted.id, name: quoted.name, body: quoted.body ?? "" } : null,
      likes: 0,
      liked: false,
      at: new Date().toISOString(),
      pending: true,
    };

    setSending(true);
    setError(null);
    setDraft("");
    setReplyTo(null);
    setOutbox((out) => [...out, temp]);
    atBottom.current = true;

    try {
      await sendCommunityMessage(body, quoted?.id ?? null);
      // Dropped here rather than swapped in place: the very next poll carries
      // the server's own row, with its real id, and two copies of one message
      // for a few hundred milliseconds is worse than none.
      setOutbox((out) => out.filter((o) => o.id !== temp.id));
      await load();
    } catch (e) {
      setOutbox((out) =>
        out.map((o) => (o.id === temp.id ? { ...o, pending: false, failed: true } : o)),
      );
      // Give the text back. Retyping a refused message is the insult on top of
      // the injury, and the refusal is usually a mute or a lock — something
      // the words had nothing to do with.
      setDraft(body);
      setReplyTo(quoted);
      setError(e instanceof CommunityError ? e.message : "Message not sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const like = useCallback(
    async (m: CommunityMessage) => {
      if (!user) {
        router.push("/auth");

        return;
      }
      // Optimistic: a like is cheap to undo, and the round trip is the whole
      // perceived cost of tapping a heart.
      setFeed((f) =>
        f
          ? {
              ...f,
              messages: f.messages.map((x) =>
                x.id === m.id ? { ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) } : x,
              ),
            }
          : f,
      );
      try {
        await likeCommunityMessage(m.id);
      } catch {
        void load(); // put it back the way the server sees it
      }
    },
    [user, load],
  );

  const startReply = useCallback((m: CommunityMessage) => {
    setReplyTo(m);
    inputRef.current?.focus();
  }, []);

  const copy = useCallback((m: CommunityMessage) => {
    void Clipboard.setStringAsync(m.body ?? "");
  }, []);

  const remove = useCallback(
    (m: CommunityMessage) => {
      Alert.alert(
        "Delete this message?",
        "It will disappear for everyone in the room. This cannot be undone.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              // Gone from the list at once; the poll confirms it. A delete that
              // waits for a round trip reads as a tap that did nothing.
              setFeed((f) => (f ? { ...f, messages: f.messages.filter((x) => x.id !== m.id) } : f));
              deleteCommunityMessage(m.id).catch((e) => {
                setError(
                  e instanceof CommunityError ? e.message : "That message could not be deleted.",
                );
                void load();
              });
            },
          },
        ],
      );
    },
    [load],
  );

  const openProduct = useCallback((slug: string) => {
    router.push({ pathname: "/product/[slug]", params: { slug } });
  }, []);

  const muted = feed?.me?.muted ?? false;
  const locked = feed?.locked ?? false;
  const canPost = Boolean(user) && !muted && (!locked || Boolean(feed?.me?.is_admin));
  const near = draft.length > MESSAGE_MAX - 60;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      {/* ---- header: the room, as a chat header rather than a bare back arrow ---- */}
      <View style={s.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}
        >
          <IconBackChevron width={20} height={20} color={theme.textInk.strong} />
        </Pressable>

        {/* The brand monogram. A literal, not a constant: `lib/site.ts` is the
            WEBSITE's one-line wordmark switch and has no counterpart here. */}
        <View style={s.roomAvatar}>
          <Text style={s.roomAvatarText}>O</Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.roomName} numberOfLines={1}>
            Community
          </Text>
          <Text style={s.roomMeta} numberOfLines={1}>
            {feed
              ? `${feed.members.toLocaleString()} member${feed.members === 1 ? "" : "s"}${locked ? " · paused" : ""}`
              : "Loading…"}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={s.body}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        // The header stays put; only the area below it compresses. Without this
        // the whole screen lifts and the header slides off the top.
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : insets.top}
      >
        {loading && !feed ? (
          <View style={s.centre}>
            <ActivityIndicator color={theme.colors.primaryOn} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={(r) => r.key}
              contentContainerStyle={s.listContent}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
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
              scrollEventThrottle={64}
              onContentSizeChange={() => {
                if (atBottom.current) {
                  listRef.current?.scrollToOffset({
                    offset: Number.MAX_SAFE_INTEGER,
                    animated: false,
                  });
                }
              }}
              ListEmptyComponent={
                <View style={s.centre}>
                  <Txt tone="body" size={13} center style={{ lineHeight: 19 }}>
                    Nothing here yet. Say hello and start the conversation.
                  </Txt>
                </View>
              }
              renderItem={({ item }) => {
                if (item.kind === "day") {
                  return (
                    <View style={s.dayWrap}>
                      <Text style={s.dayChip}>{item.label}</Text>
                    </View>
                  );
                }

                return (
                  <CommunityMessageRow
                    message={item.message}
                    first={item.first}
                    last={item.last}
                    onReply={startReply}
                    onLongPress={setActing}
                    onLike={like}
                    onOpenProduct={openProduct}
                  />
                );
              }}
            />

            {/* ---- jump to the newest, with what you have missed ---- */}
            {showJump && (
              <Pressable
                onPress={() => toBottom()}
                accessibilityRole="button"
                accessibilityLabel={
                  unseen > 0 ? `${unseen} new messages. Jump to the latest.` : "Jump to the latest"
                }
                style={({ pressed }) => [s.jump, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.jumpChevron}>⌄</Text>
                {unseen > 0 && (
                  <View style={s.jumpBadge}>
                    <Text style={s.jumpBadgeText}>{unseen > 99 ? "99+" : unseen}</Text>
                  </View>
                )}
              </Pressable>
            )}
          </View>
        )}

        {error && <Text style={s.error}>{error}</Text>}

        {/* ---- composer ---- */}
        <View style={[s.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {canPost ? (
            <>
              {replyTo && (
                <View style={s.replyBar}>
                  <IconReply width={15} height={15} color={theme.colors.primaryOn} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.replyName} numberOfLines={1}>
                      {replyTo.mine ? "Replying to yourself" : `Replying to ${replyTo.name}`}
                    </Text>
                    <Text style={s.replyBody} numberOfLines={1}>
                      {replyTo.type === "product"
                        ? ((replyTo.product as { name?: string } | null)?.name ?? "Product")
                        : (replyTo.body ?? "")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setReplyTo(null)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reply"
                    style={s.replyClose}
                  >
                    <Text style={s.replyCloseText}>✕</Text>
                  </Pressable>
                </View>
              )}

              <View style={s.composer}>
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Message the community…"
                  placeholderTextColor={theme.textInk.faint}
                  style={s.input}
                  multiline
                  // The server's own ceiling (CommunityController::send
                  // validates max:500). It used to be 1000 here, so a long
                  // message typed fine and was then refused on send.
                  maxLength={MESSAGE_MAX}
                  accessibilityLabel="Your message"
                />
                <Pressable
                  onPress={send}
                  disabled={sending || draft.trim().length === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={({ pressed }) => [
                    s.send,
                    (sending || draft.trim().length === 0) && s.sendIdle,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <IconSend width={17} height={17} />
                </Pressable>
              </View>

              {/* Only once it is nearly spent — a counter on an empty box is
                  a limit announced before anyone has met it. */}
              {near && (
                <Text style={s.counter}>
                  {MESSAGE_MAX - draft.length} character
                  {MESSAGE_MAX - draft.length === 1 ? "" : "s"} left
                </Text>
              )}
            </>
          ) : (
            <Pressable
              onPress={() => (user ? undefined : router.push("/auth"))}
              style={s.notice}
              accessibilityRole={user ? "text" : "button"}
            >
              <Text style={s.noticeText}>
                {!user
                  ? "Sign in to join the conversation"
                  : muted
                    ? "You can't post in the room right now."
                    : "The shop has paused messages for now."}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <CommunityActions
        message={acting}
        canDelete={Boolean(acting?.mine)}
        onClose={() => setActing(null)}
        onReply={startReply}
        onCopy={copy}
        onLike={like}
        onDelete={remove}
      />
    </View>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.colors.surface },
  body: { flex: 1, backgroundColor: t.surfaces.chat },

  /**
   * The header is on `surface`, not on the chat ground.
   *
   * Every messenger separates the two: the bar that names the room is chrome,
   * the area below it is the conversation. One continuous colour is what made
   * this screen read as a feed with a back arrow on it.
   */
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: t.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaces.lineSoft,
  },
  back: { width: 32, height: 40, alignItems: "flex-start", justifyContent: "center" },
  roomAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  roomAvatarText: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: "#FFFFFF",
    includeFontPadding: false,
  },
  roomName: {
    fontFamily: fonts.medium,
    fontSize: 15.5,
    color: t.textInk.strong,
    includeFontPadding: false,
  },
  roomMeta: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: t.textInk.faint,
    marginTop: 2,
    includeFontPadding: false,
  },

  centre: { paddingTop: 60, alignItems: "center", paddingHorizontal: GUTTER },
  listContent: { paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 12 },

  dayWrap: { alignItems: "center", marginVertical: 12 },
  dayChip: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: t.textInk.faint,
    backgroundColor: t.surfaces.chatBubble,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: "hidden",
  },

  jump: {
    position: "absolute",
    right: GUTTER,
    bottom: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.surfaces.chatBubble,
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

  error: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: t.colors.danger,
    textAlign: "center",
    paddingHorizontal: GUTTER,
    paddingBottom: 6,
  },

  composerWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.lineSoft,
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: t.surfaces.actionTint,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.gold2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  replyName: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },
  replyBody: { fontFamily: fonts.body, fontSize: 11.5, color: t.textInk.faint, marginTop: 1 },
  replyClose: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  replyCloseText: { fontFamily: fonts.body, fontSize: 13, color: t.textInk.faint },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: t.colors.ink,
    backgroundColor: t.surfaces.stepperTrack,
    borderRadius: 22,
    maxHeight: 108,
    minHeight: 42,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIdle: { backgroundColor: t.surfaces.handle },
  counter: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: t.textInk.faint,
    textAlign: "right",
    paddingTop: 5,
    paddingRight: 54,
  },

  notice: { paddingVertical: 12 },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: t.textInk.faint,
    textAlign: "center",
  },
});
