import { Image } from "expo-image";
import { useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { IconClock, IconHeart, IconReply, IconVerified } from "@/components/icons";
import type { CommunityMessage } from "@/lib/community";
import { naira } from "@/lib/format";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * One message in the community room.
 *
 * This follows the conventions every mainstream messenger shares, because they
 * are not decoration — each one answers a question the reader would otherwise
 * have to work out for themselves:
 *
 *   · THE TAIL IS ON THE FIRST BUBBLE OF A RUN, not the last. A run of messages
 *     reads top-down, so the tail belongs where the run STARTS; the screen used
 *     to square the bottom corner of the last bubble, which points the run at
 *     whatever comes after it. Subsequent bubbles in a run are fully rounded.
 *   · THE AVATAR IS ON THE FIRST BUBBLE TOO, for the same reason, and the gutter
 *     is held on the rest so a run stays in one column.
 *   · THE TIME LIVES INSIDE THE BUBBLE, bottom-right, on EVERY message. Once per
 *     run is cheaper vertically and it means the only message whose time you
 *     actually want — the one you are reading — often has not got one.
 *   · THE NAME IS COLOURED PER SENDER. In a group, colour is how you track who
 *     is speaking without reading the name every time.
 *   · SWIPE RIGHT TO REPLY. The gesture is the one people already have in their
 *     fingers; the long-press menu is the discoverable path to the same thing.
 *
 * The time row is a sibling of the text rather than absolutely positioned over
 * it. Overlaying is how the big messengers do it — they reserve a run of
 * trailing space inside the last text line — but that needs text measurement to
 * know whether the last line has room, and getting it wrong puts a timestamp on
 * top of a word. A dedicated row is a few points taller and always correct.
 *
 * Built on React Native's own `Animated` and `PanResponder`: `react-native-
 * reanimated` is installed but used by nothing in this app and there is no
 * babel.config.js pinning its plugin, so a worklet here would be the first and
 * the least verifiable. `concierge-fab.tsx` already animates this way.
 */

/** How far the bubble travels before the swipe counts as a reply. */
const REPLY_THRESHOLD = 46;
/** Past this the bubble stops following the finger, so it cannot be dragged off. */
const REPLY_MAX = 64;
const AVATAR = 30;

/**
 * Name colours, assigned by user id.
 *
 * Both lists clear 4.5:1 on their own theme's bubble fill. They are brand-
 * adjacent rather than a rainbow — purple, plum, teal, gold, rose, indigo — so
 * a busy room still reads as this shop and not as a palette test.
 */
const NAME_COLOURS_LIGHT = ["#7A3E9D", "#A8895C", "#2F6F5E", "#A8445E", "#3A5BA8", "#8A5A2B"];
const NAME_COLOURS_DARK = ["#C9A4E6", "#DEC79B", "#7FC8AE", "#F0929F", "#9DB4F0", "#D9A86A"];

function nameColour(userId: number | null, dark: boolean): string {
  const list = dark ? NAME_COLOURS_DARK : NAME_COLOURS_LIGHT;

  return list[Math.abs(userId ?? 0) % list.length];
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);

  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function CommunityMessageRow({
  message,
  first,
  last,
  onReply,
  onLongPress,
  onLike,
  onOpenProduct,
}: {
  message: CommunityMessage & { pending?: boolean; failed?: boolean };
  /** First of a run — carries the name, the avatar and the tail. */
  first: boolean;
  /** Last of a run — carries the gap that separates one speaker from the next. */
  last: boolean;
  onReply: (m: CommunityMessage) => void;
  onLongPress: (m: CommunityMessage) => void;
  onLike: (m: CommunityMessage) => void;
  onOpenProduct: (slug: string) => void;
}) {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const m = message;
  const mine = m.mine;

  const slide = useRef(new Animated.Value(0)).current;
  /**
   * Whether this drag has already been claimed as a reply.
   *
   * The release handler and the cancel handler can both fire, and a reply must
   * not be raised twice for one gesture.
   */
  const fired = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly HORIZONTAL and rightward.
        // Anything else has to stay with the list, or the chat stops scrolling.
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderGrant: () => {
          fired.current = false;
        },
        onPanResponderMove: (_e, g) => {
          if (g.dx <= 0) {
            slide.setValue(0);

            return;
          }
          // Rubber-banding past the threshold: the bubble keeps moving but at a
          // third of the finger's speed, which is what makes the stop feel like
          // a limit rather than a dropped gesture.
          const over = Math.max(0, g.dx - REPLY_THRESHOLD);
          slide.setValue(Math.min(REPLY_MAX, g.dx - over * 0.66));
        },
        onPanResponderRelease: (_e, g) => {
          if (!fired.current && g.dx >= REPLY_THRESHOLD) {
            fired.current = true;
            onReply(m);
          }
          Animated.spring(slide, {
            toValue: 0,
            useNativeDriver: true,
            speed: 20,
            bounciness: 6,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
        },
      }),
    [m, onReply, slide],
  );

  const replyOpacity = slide.interpolate({
    inputRange: [0, REPLY_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const product = m.type === "product" ? (m.product as ProductMeta | null) : null;
  const time = timeOf(m.at);

  return (
    <View style={[s.row, mine && s.rowMine, last && s.rowRunEnd]}>
      {/* The reply affordance is revealed by the bubble moving off it, so it
          sits behind rather than beside — it must not take layout width. */}
      <Animated.View style={[s.replyHint, { opacity: replyOpacity }]} pointerEvents="none">
        <IconReply width={16} height={16} color={theme.colors.primaryOn} />
      </Animated.View>

      {!mine && (
        <View style={s.avatarSlot}>
          {first &&
            (m.avatar ? (
              <Image source={{ uri: m.avatar }} style={s.avatar} contentFit="cover" />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarText}>{initials(m.name)}</Text>
              </View>
            ))}
        </View>
      )}

      <Animated.View
        style={[s.stack, mine && s.stackMine, { transform: [{ translateX: slide }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          onLongPress={() => onLongPress(m)}
          delayLongPress={300}
          accessibilityRole="button"
          accessibilityLabel={
            `${mine ? "You" : m.name}${m.team ? ", OsyGentle team" : ""}: ` +
            `${product ? product.name : m.body ?? ""}${time ? `, ${time}` : ""}`
          }
          accessibilityHint="Hold for reply, copy and more"
          style={[
            s.bubble,
            mine ? s.bubbleMine : s.bubbleTheirs,
            // The tail squares the corner nearest the sender on the FIRST
            // bubble of a run, which is where the run begins.
            first && (mine ? s.tailMine : s.tailTheirs),
            m.failed && s.bubbleFailed,
          ]}
        >
          {first && !mine && (
            <View style={s.nameRow}>
              <Text style={[s.name, { color: nameColour(m.user_id, theme.dark) }]} numberOfLines={1}>
                {m.name}
              </Text>
              {m.team && <Text style={s.teamTag}>Team</Text>}
            </View>
          )}

          {m.reply && (
            <View style={[s.quote, mine && s.quoteMine]}>
              <Text style={[s.quoteName, mine && s.quoteNameMine]} numberOfLines={1}>
                {m.reply.name}
              </Text>
              <Text style={[s.quoteBody, mine && s.quoteBodyMine]} numberOfLines={2}>
                {m.reply.body}
              </Text>
            </View>
          )}

          {/* A product message carries an EMPTY body and its detail in `meta`
              (CommunityController::postProduct). Rendering only the body showed
              the shop's own posts as blank bubbles. */}
          {product ? (
            <ProductCard meta={product} mine={mine} onPress={() => onOpenProduct(product.slug)} />
          ) : m.body ? (
            <Text style={[s.body, mine && s.bodyMine]}>{m.body}</Text>
          ) : null}

          <View style={s.meta}>
            <Text style={[s.time, mine && s.timeMine]}>{time}</Text>
            {/* Only on your own messages, and only three states: on its way,
                with the server, or refused. A group room has no read receipts
                to report, so there is no second tick to draw. */}
            {mine &&
              (m.pending ? (
                <IconClock width={11} height={11} color="rgba(255,255,255,0.7)" />
              ) : m.failed ? (
                <Text style={s.failedMark}>!</Text>
              ) : (
                <IconVerified width={12} height={12} color="rgba(255,255,255,0.8)" />
              ))}
          </View>
        </Pressable>

        {/* Reactions exist only once someone has used one — an empty heart on
            every message is the clutter that makes a room look unfinished. */}
        {m.likes > 0 && (
          <Pressable
            onPress={() => onLike(m)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${m.likes} like${m.likes === 1 ? "" : "s"}. Tap to ${m.liked ? "remove yours" : "add yours"}.`}
            style={[s.likePill, mine && s.likePillMine]}
          >
            <IconHeart
              width={11}
              height={11}
              color={m.liked ? theme.colors.primaryOn : theme.textInk.faint}
            />
            <Text style={[s.likeCount, m.liked && { color: theme.colors.primaryOn }]}>{m.likes}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

/** What `postProduct` writes into `meta`. */
interface ProductMeta {
  slug: string;
  name: string;
  spec?: string | null;
  price: number;
  sale_price?: number | null;
  discount_percent?: number;
  image?: string | null;
}

/** The shop's own product post, as a card the room can tap through to. */
function ProductCard({
  meta,
  mine,
  onPress,
}: {
  meta: ProductMeta;
  mine: boolean;
  onPress: () => void;
}) {
  const s = useThemedStyles(makeS);
  const sale = meta.sale_price && meta.sale_price < meta.price ? meta.sale_price : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name}, ${naira(sale ?? meta.price)}. Open the product.`}
      style={({ pressed }) => [s.product, pressed && { opacity: 0.85 }]}
    >
      {meta.image ? (
        <Image source={{ uri: meta.image }} style={s.productImage} contentFit="cover" />
      ) : (
        <View style={[s.productImage, s.productImageEmpty]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[s.productName, mine && s.bodyMine]} numberOfLines={2}>
          {meta.name}
        </Text>
        {meta.spec ? (
          <Text style={[s.productSpec, mine && s.quoteBodyMine]} numberOfLines={1}>
            {meta.spec}
          </Text>
        ) : null}
        <View style={s.priceRow}>
          <Text style={[s.price, mine && s.bodyMine]}>{naira(sale ?? meta.price)}</Text>
          {sale ? <Text style={[s.was, mine && s.quoteBodyMine]}>{naira(meta.price)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const BUBBLE_RADIUS = 16;
const TAIL_RADIUS = 4;

const makeS = (t: Theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginBottom: 2 },
  rowMine: { justifyContent: "flex-end" },
  rowRunEnd: { marginBottom: 10 },

  replyHint: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarSlot: { width: AVATAR, height: AVATAR },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: t.colors.imgBg },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.primaryCont,
  },
  avatarText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  stack: { maxWidth: "78%", alignItems: "flex-start" },
  stackMine: { alignItems: "flex-end", marginLeft: "auto" },

  /**
   * No border on a bubble.
   *
   * A 1px outline is this app's language for a CARD — a form field, a product
   * tile, a panel. On a speech bubble it reads as an input box, which is what
   * made the room look like a list of controls. The tinted `chat` ground does
   * the separating instead, and iOS gets the faintest lift so a white bubble
   * does not float unanchored.
   */
  bubble: {
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 5,
    borderRadius: BUBBLE_RADIUS,
    minWidth: 92,
  },
  bubbleTheirs: { backgroundColor: t.surfaces.chatBubble },
  bubbleMine: { backgroundColor: t.colors.primary },
  bubbleFailed: { backgroundColor: t.colors.danger },
  tailTheirs: { borderTopLeftRadius: TAIL_RADIUS },
  tailMine: { borderTopRightRadius: TAIL_RADIUS },

  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  name: { fontFamily: fonts.medium, fontSize: 12.5, flexShrink: 1 },
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

  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: t.textInk.strong },
  bodyMine: { color: "#FFFFFF" },

  /** The time row. `marginTop: -2` pulls it close without overlapping. */
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: -1 },
  time: { fontFamily: fonts.body, fontSize: 10, color: t.textInk.faint },
  timeMine: { color: "rgba(255,255,255,0.72)" },
  failedMark: { fontFamily: fonts.medium, fontSize: 11, color: "#FFFFFF" },

  quote: {
    borderLeftWidth: 2.5,
    borderLeftColor: t.colors.gold2,
    backgroundColor: t.surfaces.actionTint,
    borderRadius: 6,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 5,
    marginBottom: 5,
  },
  quoteMine: {
    borderLeftColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  quoteName: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },
  quoteNameMine: { color: "#FFFFFF" },
  quoteBody: { fontFamily: fonts.body, fontSize: 11.5, color: t.textInk.faint, marginTop: 1 },
  quoteBodyMine: { color: "rgba(255,255,255,0.8)" },

  likePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: -5,
    marginLeft: 10,
    backgroundColor: t.surfaces.chatBubble,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  likePillMine: { marginLeft: 0, marginRight: 10 },
  likeCount: { fontFamily: fonts.medium, fontSize: 10, color: t.textInk.faint },

  product: { flexDirection: "row", gap: 10, width: 214, paddingVertical: 2 },
  productImage: { width: 58, height: 72, borderRadius: 8, backgroundColor: t.colors.imgBg },
  productImageEmpty: { backgroundColor: t.colors.imgBg2 },
  productName: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: t.textInk.strong },
  productSpec: { fontFamily: fonts.body, fontSize: 10.5, color: t.textInk.faint, marginTop: 2 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  price: { fontFamily: fonts.display, fontSize: 15, color: t.textInk.strong },
  was: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: t.textInk.faint,
    textDecorationLine: "line-through",
  },
});
