import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { CircleBack, IconBackChevron, IconHeart, IconHeartOutline, IconSend } from "@/components/icons";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  CommunityError,
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
 * The list follows the conventions every messaging app shares, because they are
 * what make a chat readable rather than a stack of cards:
 *
 *   · consecutive messages from one person GROUP — the name appears once at the
 *     top of a run and the avatar once at the bottom, instead of repeating on
 *     every line and tripling the vertical cost of a quick back-and-forth;
 *   · the bubble's corner nearest its sender is squared off, which is what
 *     makes a column of bubbles read as "from this side" without a tail;
 *   · the timestamp shows once per run, not per message;
 *   · days are separated, so "4:45 PM" is never ambiguous.
 */

const POLL_MS = 4000;
const GUTTER = layout.gutter;
/** Messages this far apart start a new run even from the same person. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

type Row =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "msg";
      key: string;
      message: CommunityMessage;
      /** First of a run — carries the name. */
      first: boolean;
      /** Last of a run — carries the avatar, the time and the bubble's corner. */
      last: boolean;
    };

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

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);

  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Flatten the feed into day separators and grouped message rows. */
function buildRows(messages: CommunityMessage[]): Row[] {
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
    const near = (a?: CommunityMessage, b?: CommunityMessage) => {
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
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [feed, setFeed] = useState<CommunityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchCommunityFeed(signal);
      if (data) {
        setFeed(data);
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

  const rows = useMemo(() => buildRows(feed?.messages ?? []), [feed?.messages]);

  // Pin to the newest message whenever one arrives. onContentSizeChange alone
  // is not enough: it can fire before avatars finish loading and grow the list,
  // which leaves the newest message below the fold — the one message a chat
  // must never hide.
  const newestId = feed?.messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (newestId === null) return;
    // A large offset rather than a measured one: this fires on a new message,
    // before the row has been laid out, so there is no correct height to ask
    // for yet. The list clamps it to the real end.
    const t = setTimeout(
      () => listRef.current?.scrollToOffset({ offset: Number.MAX_SAFE_INTEGER, animated: false }),
      80,
    );

    return () => clearTimeout(t);
  }, [newestId]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      await sendCommunityMessage(body);
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof CommunityError ? e.message : "Message not sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function like(m: CommunityMessage) {
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
  }

  const muted = feed?.me?.muted ?? false;
  const locked = feed?.locked ?? false;
  const canPost = Boolean(user) && !muted && (!locked || Boolean(feed?.me?.is_admin));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* No title: the screen is the room, and naming it again above the
          messages only costs the height the conversation wants. The back
          control is NOT optional — this tab hides the bottom bar. */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <IconBackChevron width={19} height={19} color={theme.textInk.strong} />
        </Pressable>

        <Txt tone="body" size={11.5} style={styles.headerMeta}>
          {feed ? `${feed.members.toLocaleString()} members` : "Loading…"}
          {locked ? " · paused" : ""}
        </Txt>
      </View>

      {loading && !feed ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{
            paddingHorizontal: GUTTER,
            paddingTop: 4,
            // Clears the composer at its TALLEST: the input grows to 96pt
            // before it scrolls, plus its padding and the bottom offset.
            paddingBottom: insets.bottom + 132,
          }}
          showsVerticalScrollIndicator={false}
          // scrollToOffset with the height the list just MEASURED, not
          // scrollToEnd. scrollToEnd resolves the end from the height the list
          // knew a moment ago, so with avatars still loading it lands short —
          // measured at ~140pt short, which is exactly enough to hide the
          // newest message. An offset past the end is clamped, so overshooting
          // is free.
          onContentSizeChange={(_w, h) => listRef.current?.scrollToOffset({ offset: h, animated: false })}
          ListEmptyComponent={
            <View style={styles.centre}>
              <Txt tone="body" size={13} style={{ textAlign: "center" }}>
                Nothing here yet. Say hello and start the conversation.
              </Txt>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === "day") {
              return (
                <View style={styles.dayWrap}>
                  <Text style={styles.dayChip}>{item.label}</Text>
                </View>
              );
            }

            const m = item.message;
            const mine = m.mine;

            return (
              <View style={[styles.row, mine && styles.rowMine, item.last && styles.rowRunEnd]}>
                {/* The gutter is held even on grouped messages, so a run's
                    bubbles stay in one column instead of stepping left. */}
                {!mine && (
                  <View style={styles.avatarSlot}>
                    {item.last &&
                      (m.avatar ? (
                        <Image source={{ uri: m.avatar }} style={styles.avatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.avatar, styles.avatarFallback]}>
                          <Text style={styles.avatarText}>{initials(m.name)}</Text>
                        </View>
                      ))}
                  </View>
                )}

                <View style={[styles.stack, mine && styles.stackMine]}>
                  {item.first && !mine && (
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>{m.name}</Text>
                      {m.team && <Text style={styles.teamTag}>Team</Text>}
                    </View>
                  )}

                  <Pressable
                    onLongPress={() => like(m)}
                    delayLongPress={250}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name}: ${m.body ?? ""}. Hold to ${m.liked ? "remove your like" : "like"}.`}
                    style={[
                      styles.bubble,
                      mine ? styles.bubbleMine : styles.bubbleTheirs,
                      // Square off the corner nearest the sender, on the last
                      // bubble of a run. This is what makes a column read as
                      // "from this side" without drawing a tail.
                      item.last && (mine ? styles.tailMine : styles.tailTheirs),
                    ]}
                  >
                    {m.reply && (
                      <View style={[styles.quote, mine && styles.quoteMine]}>
                        <Text style={[styles.quoteName, mine && styles.quoteNameMine]} numberOfLines={1}>
                          {m.reply.name}
                        </Text>
                        <Text style={[styles.quoteBody, mine && styles.quoteBodyMine]} numberOfLines={2}>
                          {m.reply.body}
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
                  </Pressable>

                  {/* Reactions sit under the bubble and only exist once someone
                      has used one — an empty affordance on every message is
                      the clutter that makes a chat look unfinished. */}
                  {m.likes > 0 && (
                    <Pressable
                      onPress={() => like(m)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`${m.likes} like${m.likes === 1 ? "" : "s"}`}
                      style={[styles.likePill, mine && styles.likePillMine]}
                    >
                      {m.liked ? (
                        <IconHeart width={11} height={11} color={theme.colors.primaryOn} />
                      ) : (
                        <IconHeartOutline width={11} height={11} color={theme.textInk.faint} />
                      )}
                      <Text style={styles.likeCount}>{m.likes}</Text>
                    </Pressable>
                  )}

                  {item.last && <Text style={[styles.time, mine && styles.timeMine]}>{timeOf(m.at)}</Text>}
                </View>
              </View>
            );
          }}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <View style={[styles.composer, { bottom: Math.max(insets.bottom, 10) }]}>
          {canPost ? (
            <>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message the community…"
                placeholderTextColor={theme.textInk.faint}
                style={styles.input}
                multiline
                maxLength={1000}
                accessibilityLabel="Your message"
              />
              <Pressable
                onPress={send}
                disabled={sending || draft.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [
                  styles.send,
                  (sending || draft.trim().length === 0) && styles.sendIdle,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <IconSend width={17} height={17} />
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => (user ? undefined : router.push("/auth"))}
              style={styles.notice}
              accessibilityRole={user ? "text" : "button"}
            >
              <Text style={styles.noticeText}>
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
    </View>
  );
}

/** Bubble geometry, in one place so the squared corner always matches. */
const BUBBLE_RADIUS = 18;
const TAIL_RADIUS = 5;
const AVATAR = 28;

const makeStyles = (t: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.surfaces.home },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: GUTTER,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    alignItems: "center",
    justifyContent: "center",
  },
  headerMeta: { flex: 1 },
  centre: { paddingTop: 60, alignItems: "center", paddingHorizontal: GUTTER },

  dayWrap: { alignItems: "center", marginVertical: 14 },
  dayChip: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 0.3,
    color: t.textInk.faint,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 11,
    overflow: "hidden",
  },

  // 2pt inside a run, 10pt between runs — the gap is what the eye reads as
  // "someone else is speaking now".
  row: { flexDirection: "row", alignItems: "flex-end", gap: 7, marginBottom: 2 },
  rowMine: { justifyContent: "flex-end" },
  rowRunEnd: { marginBottom: 10 },

  avatarSlot: { width: AVATAR, height: AVATAR, justifyContent: "flex-end" },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: t.colors.imgBg },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.primaryCont,
  },
  avatarText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },

  stack: { maxWidth: "76%", alignItems: "flex-start" },
  stackMine: { alignItems: "flex-end", marginLeft: "auto" },

  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, paddingLeft: 2 },
  name: { fontFamily: fonts.medium, fontSize: 11.5, color: t.textInk.strong },
  teamTag: {
    fontFamily: fonts.medium,
    fontSize: 8.5,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.colors.primaryOn,
    backgroundColor: t.colors.primaryCont,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    overflow: "hidden",
  },

  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: BUBBLE_RADIUS },
  bubbleTheirs: {
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
  },
  bubbleMine: { backgroundColor: t.colors.primary },
  tailTheirs: { borderBottomLeftRadius: TAIL_RADIUS },
  tailMine: { borderBottomRightRadius: TAIL_RADIUS },

  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19.5, color: t.textInk.strong },
  bodyMine: { color: "#FFFFFF" },

  quote: {
    borderLeftWidth: 2,
    borderLeftColor: t.colors.gold2,
    paddingLeft: 8,
    marginBottom: 6,
  },
  quoteMine: { borderLeftColor: "rgba(255,255,255,0.55)" },
  quoteName: { fontFamily: fonts.medium, fontSize: 10.5, color: t.colors.gold2 },
  quoteNameMine: { color: "rgba(255,255,255,0.9)" },
  quoteBody: { fontFamily: fonts.body, fontSize: 11, color: t.textInk.faint },
  quoteBodyMine: { color: "rgba(255,255,255,0.75)" },

  likePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: -6,
    marginLeft: 8,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.lineProduct,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9,
  },
  likePillMine: { marginLeft: 0, marginRight: 8 },
  likeCount: { fontFamily: fonts.medium, fontSize: 10, color: t.textInk.faint },

  time: { fontFamily: fonts.body, fontSize: 10, color: t.textInk.faint, marginTop: 3, paddingLeft: 2 },
  timeMine: { paddingLeft: 0, paddingRight: 2 },

  error: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: t.colors.danger,
    textAlign: "center",
    paddingHorizontal: GUTTER,
    paddingBottom: 6,
  },

  composer: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.surfaces.lineSearch,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: t.colors.ink,
    maxHeight: 96,
    paddingTop: 8,
    paddingBottom: 8,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIdle: { backgroundColor: t.surfaces.lineProduct },
  notice: { flex: 1, paddingVertical: 12 },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: t.textInk.faint,
    textAlign: "center",
  },
});
