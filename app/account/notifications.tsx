import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  SectionLabel,
} from "@/components/account-ui";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import { toneFor, visualFor } from "@/lib/notification-visuals";
import {
  deleteNotification,
  getNotificationPreferences,
  getNotifications,
  markRead,
  notificationText,
  routeForLink,
  setMarketingEmails,
  type AppNotification,
  type NotificationPreferences,
} from "@/lib/notifications-api";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * The notification feed.
 *
 * Deliberately NOT polled. The badge endpoint exists for that — this screen is
 * a read when someone opens it, plus pull-to-refresh. All seven notification
 * routes share one 60-per-minute bucket with the wallet, orders and coupons,
 * so a feed poll here would rate-limit unrelated screens.
 *
 * Presentation lives in `lib/notification-visuals.ts`, which takes the row's
 * TONE from `group` — a small vocabulary the API normalises — and its GLYPH
 * from `type` through a lookup with a per-group default. Nothing here switches
 * exhaustively on `type`: that column is free text server-side and new ones
 * ship without an app release.
 *
 * Deleting is a HARD delete with no undo endpoint, which is why it asks first.
 */

const PAGE = 25;

export default function NotificationsScreen() {
  const theme = useTheme();
  const s = useThemedStyles(makeS);
  const { signedIn } = useAuth();
  // Above every early return — a hook, and the feed quotes money in its prose.
  const money = useApproxMoney();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [more, setMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [savingPref, setSavingPref] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      // The feed response carries the badge, so opening this screen is one
      // call rather than two.
      const page = await getNotifications({ limit: PAGE });
      setItems(page.data);
      setUnread(page.unread);
      setCursor(page.next_before);
      setMore(page.has_more);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your notifications.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);

      return;
    }
    void load();
    getNotificationPreferences().then(setPrefs).catch(() => setPrefs(null));
  }, [signedIn, load]);

  async function loadMore() {
    if (!more || paging || cursor === null) return;

    setPaging(true);
    try {
      const page = await getNotifications({ limit: PAGE, before: cursor });
      // Guard against a duplicate if a row shifted between pages.
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));

        return [...prev, ...page.data.filter((n) => !seen.has(n.id))];
      });
      setCursor(page.next_before);
      setMore(page.has_more);
    } catch {
      // Silent: the page they already have still works.
    } finally {
      setPaging(false);
    }
  }

  async function open(n: AppNotification) {
    // Optimistic: the endpoint returns only the new count, not the row.
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      markRead(n.id)
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    }

    router.push(routeForLink(n.link) as never);
  }

  async function readAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try {
      const r = await markRead();
      setUnread(r.unread);
    } catch {
      void load(true);
    }
  }

  async function remove(id: number) {
    setConfirming(null);
    const keep = items;
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      const r = await deleteNotification(id);
      setUnread(r.unread);
    } catch (err) {
      // It is a hard delete; if it did not happen, put the row back rather
      // than leaving the list lying about what exists.
      setItems(keep);
      setError(err instanceof ApiError ? err.message : "We couldn’t delete that.");
    }
  }

  async function togglePref(on: boolean) {
    if (!prefs) return;

    setSavingPref(true);
    setPrefs({ ...prefs, marketing_emails: on });
    try {
      // Trust the echoed value over the optimistic one.
      setPrefs(await setMarketingEmails(on));
    } catch {
      setPrefs({ ...prefs, marketing_emails: !on });
    } finally {
      setSavingPref(false);
    }
  }

  const grouped = useMemo(() => items, [items]);

  if (!signedIn) {
    return (
      <AccountShell title="Notifications" subtitle="Order updates and account news.">
        <Empty
          title="Sign in to see them"
          body="Notifications are about your own orders and account, so they need an account."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : "You're up to date."}
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
      action={
        unread > 0
          ? { label: "Mark all as read", icon: <ReadAllGlyph />, onPress: () => void readAll() }
          : undefined
      }
    >
      {loading ? <Loading label="Loading…" /> : null}
      {error && items.length === 0 ? <Failed message={error} onRetry={() => void load()} /> : null}

      {!loading && items.length === 0 && !error ? (
        <Empty
          title="Nothing yet"
          body="When an order moves, a reward lands or we have news for you, it shows up here."
        />
      ) : null}

      {grouped.map((n) => {
        const { kind, Icon } = visualFor(n);
        const tone = toneFor(kind, theme);
        // Naira as stored, unless the server sent a template for the figure —
        // then the same sentence in the shopper's chosen currency.
        const { title, body } = notificationText(n, money);

        return (
          <Panel key={n.id} padded={false}>
            <Pressable
              onPress={() => void open(n)}
              onLongPress={() => setConfirming(n.id)}
              accessibilityRole="button"
              accessibilityLabel={`${title}${n.read ? "" : ", unread"}. ${body ?? ""}`}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}
            >
              <View style={[s.well, { backgroundColor: tone.well }]}>
                <Icon width={18} height={18} color={tone.ink} />
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={s.group}>{n.group.toUpperCase()}</Text>
                  <Text style={s.when}>{when(n.at)}</Text>

                  {/* Unread, moved out of the icon well.
                      It used to BE the well's only content, so filling the well
                      with a glyph would have taken the one marker this screen
                      has — the title's medium weight is a difference you only
                      see with a read row directly above it. Out here it sits on
                      the same baseline as the timestamp, in the row's own tone,
                      and is the single thing on the line that is filled in. */}
                  {!n.read ? (
                    <View style={s.unreadDot} />
                  ) : null}
                </View>

                <Txt
                  tone="strong"
                  size={12}
                  weight={n.read ? undefined : "medium"}
                  style={{ marginTop: 5, lineHeight: 17 }}
                >
                  {title}
                </Txt>

                {body ? (
                  <Txt tone="body" size={10} style={{ marginTop: 4, lineHeight: 15 }}>
                    {body}
                  </Txt>
                ) : null}
              </View>
            </Pressable>

            {/* Hard delete, no undo — so it asks. */}
            {confirming === n.id ? (
              <View style={s.confirm}>
                <Txt tone="body" size={10} style={{ flex: 1, lineHeight: 14 }}>
                  Delete this? It can’t be brought back.
                </Txt>
                <Pressable
                  onPress={() => setConfirming(null)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.confirmBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.confirmKeep}>Keep</Text>
                </Pressable>
                <Pressable
                  onPress={() => void remove(n.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete "${title}"`}
                  style={({ pressed }) => [s.confirmBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={s.confirmGo}>Delete</Text>
                </Pressable>
              </View>
            ) : null}
          </Panel>
        );
      })}

      {more ? (
        <Pressable
          onPress={() => void loadMore()}
          disabled={paging}
          accessibilityRole="button"
          style={({ pressed }) => [s.moreBtn, pressed && { opacity: 0.75 }]}
        >
          {paging ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={s.moreText}>Show older</Text>
          )}
        </Pressable>
      ) : null}

      {items.length > 0 ? (
        <Txt tone="body" size={9} center style={{ marginTop: 14, lineHeight: 13 }}>
          Press and hold a notification to delete it.
        </Txt>
      ) : null}

      {/* ---- the one preference a customer owns ---- */}
      {prefs ? (
        <>
          <SectionLabel>EMAILS</SectionLabel>
          <Panel>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Txt tone="strong" size={12} weight="medium">
                  Offers and news
                </Txt>
                <Txt tone="body" size={10} style={{ marginTop: 4, lineHeight: 15 }}>
                  Occasional emails about new arrivals and sales.
                </Txt>
              </View>
              <Switch
                value={prefs.marketing_emails}
                onValueChange={(v) => void togglePref(v)}
                disabled={savingPref}
                trackColor={{ false: theme.surfaces.lineSoft, true: theme.colors.primary }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Offers and news emails"
              />
            </View>

            {/* The server owns this sentence — rendered, not reworded. */}
            <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 13 }}>
              {prefs.transactional_note}
            </Txt>
          </Panel>
        </>
      ) : null}
    </AccountShell>
  );
}

/** A tick, so "mark all read" needs no new asset. */
function ReadAllGlyph() {
  const theme = useTheme();
  return <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: theme.textInk.body }}>✓</Text>;
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`;

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const makeS = (t: Theme) => StyleSheet.create({
  row: { flexDirection: "row", gap: 12, padding: 16 },
  // The account area's 34pt icon well (see `Row` in components/account-ui).
  well: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * One fixed, legible colour — NOT the row's tone.
   *
   * Taking the tone made the dot agree with the glyph, which reads nicely and
   * fails at the job: on the warm wells the tone is gold, and a 7px gold dot on
   * white is about 2.7:1, under the 3:1 floor. Worse, it sits 8px from a grey
   * timestamp, so at that contrast it reads as punctuation rather than status.
   * `primaryOn` is the brand purple that is legible on both themes' grounds and
   * clears 10:1 in light, which is what the previous build used.
   */
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.primaryOn },

  group: {
    fontFamily: fonts.medium,
    fontSize: 8.5,
    letterSpacing: 1.3,
    color: t.textInk.faint,
  },
  when: { fontFamily: fonts.body, fontSize: 9, color: t.textInk.faint },

  confirm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  confirmBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  confirmKeep: { fontFamily: fonts.medium, fontSize: 11, color: t.textInk.body },
  confirmGo: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.danger },

  moreBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },
});
