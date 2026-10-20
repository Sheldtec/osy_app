import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { Txt } from "@/components/ui";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import { useStorefrontSettings } from "@/lib/settings";
import {
  browseThrift,
  ownersLabel,
  thriftHref,
  thriftSpec,
  type ThriftCard,
  type ThriftMeta,
} from "@/lib/thrift-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * The pre-loved market — everything customers have put up for resale.
 *
 * Browsing only. Listing a piece, asking to buy one and the escrow that
 * follows are all on the API already and all deliberately absent: the shopper
 * can see the market, and nothing on this screen implies they can transact in
 * it yet.
 *
 * Two things carry the whole idea and so are on every card: the CODE, which
 * names the one physical unit, and the OWNER COUNT, which is the history that
 * code buys you. Both come from the server; neither is inferred.
 *
 * Paged with an explicit "Show more" rather than an infinite list. The market
 * is small today, and a button cannot wedge the way an `onEndReached` list can
 * when the first page is shorter than the viewport.
 */

export default function ThriftScreen() {
  const s = useThemedStyles(makeS);
  // Catalogue prices the shopper is READING, so they convert.
  const money = useApproxMoney();
  const { features, loading: gating } = useStorefrontSettings();

  const [rows, setRows] = useState<ThriftCard[] | null>(null);
  const [meta, setMeta] = useState<ThriftMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** A failed "Show more" — kept apart from `error`, which replaces the list. */
  const [moreError, setMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await browseThrift(1);
      setRows(page.data);
      setMeta(page.meta);
      setError(null);
      setMoreError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "We couldn’t load the resale market.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Nothing is fetched until the owner's flag says the market is open — a
  // request for a screen that will not be shown is wasted either way.
  const open = features.thrift;

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const next =
    meta !== null && meta.current_page < meta.last_page ? meta.current_page + 1 : null;

  async function showMore() {
    if (next === null || loadingMore) return;

    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await browseThrift(next);
      setRows((prev) => [...(prev ?? []), ...page.data]);
      setMeta(page.meta);
    } catch (err) {
      setMoreError(
        err instanceof ApiError ? err.message : "We couldn’t load any more listings.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  // ---- gates ---------------------------------------------------------------
  if (gating) {
    return (
      <AccountShell title="Pre-loved" subtitle="Opening the resale market…">
        <Loading label="Opening the resale market…" />
      </AccountShell>
    );
  }

  if (!open) {
    return (
      <AccountShell title="Pre-loved" subtitle="The resale market is closed just now.">
        <Empty
          title="Not available"
          body="Our pre-loved market is switched off at the moment. Everything else in the shop is open as usual."
          action={{ label: "Browse the shop", onPress: () => router.replace("/shop") }}
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Pre-loved"
      subtitle={
        meta
          ? `${meta.total} verified ${meta.total === 1 ? "piece" : "pieces"}, resold by the women who wore them.`
          : "Verified pieces, resold by the women who wore them."
      }
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      {rows === null && error === null ? <Loading label="Loading the market…" /> : null}
      {error && rows === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {rows?.length === 0 ? (
        <Empty
          title="Nothing listed yet"
          body="No one has a piece up for resale at the moment. New listings appear here as soon as they're approved."
          action={{ label: "Browse the shop", onPress: () => router.replace("/shop") }}
        />
      ) : null}

      {rows?.map((l) => {
        const spec = thriftSpec(l).join(" · ");
        const was = l.compare_at;

        return (
          <Panel key={l.slug}>
            <Pressable
              onPress={() => router.push(thriftHref(l.slug))}
              accessibilityRole="button"
              accessibilityLabel={`${l.title}. ${l.condition}. ${ownersLabel(l.owners)}. ${money(
                l.price,
              )}. Code ${l.code}`}
              style={({ pressed }) => [
                { flexDirection: "row", gap: 12 },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Thumb src={l.image} seed={l.slug} alt={l.title} width={96} height={116} radius={16} />

              <View style={{ flex: 1 }}>
                <Txt tone="strong" display size={17} numberOfLines={2} style={{ lineHeight: 22 }}>
                  {l.title}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 4 }} numberOfLines={1}>
                  {l.condition}
                </Txt>
                {spec ? (
                  <Txt
                    tone="body"
                    size={9}
                    numberOfLines={2}
                    style={{ marginTop: 4, lineHeight: 13 }}
                  >
                    {spec}
                  </Txt>
                ) : null}

                {/* The traceable code, on the piece it belongs to. Selectable
                    because someone comparing a listing against the unit in
                    their hands will want to copy it. */}
                <Text style={s.code} selectable>
                  {l.code}
                </Text>

                <View style={s.priceRow}>
                  {was !== null && was > l.price ? <Text style={s.was}>{money(was)}</Text> : null}
                  <Txt tone="primary" display size={17}>
                    {money(l.price)}
                  </Txt>
                </View>
              </View>
            </Pressable>

            <View style={s.foot}>
              <Pill label={ownersLabel(l.owners)} tone="mute" />
              {l.seller ? (
                <Txt
                  tone="body"
                  size={9}
                  numberOfLines={1}
                  style={{ flex: 1, textAlign: "right" }}
                >
                  {l.seller}
                </Txt>
              ) : null}
            </View>
          </Panel>
        );
      })}

      {next !== null ? (
        <>
          <Pressable
            onPress={() => void showMore()}
            disabled={loadingMore}
            accessibilityRole="button"
            accessibilityLabel="Show more listings"
            style={({ pressed }) => [s.more, pressed && { opacity: 0.75 }]}
          >
            <Text style={s.moreText}>{loadingMore ? "Loading…" : "Show more"}</Text>
          </Pressable>
          {moreError ? (
            <Txt tone="danger" size={10} center style={{ marginTop: 10, lineHeight: 15 }}>
              {moreError}
            </Txt>
          ) : null}
        </>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <SectionLabel>HOW RESALE WORKS</SectionLabel>
          <Panel>
            <Txt tone="body" size={10} style={{ lineHeight: 16 }}>
              Every piece listed here was bought from us, and its code names that one unit — so
              its full ownership history travels with it. You can see how many women have worn
              a piece before you decide.
            </Txt>
          </Panel>
        </>
      ) : null}
    </AccountShell>
  );
}

const makeS = (t: Theme) => StyleSheet.create({
  code: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 0.6,
    color: t.textInk.strong,
    marginTop: 6,
    includeFontPadding: false,
  },

  priceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 8 },
  was: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: t.textInk.faint,
    textDecorationLine: "line-through",
    marginRight: 8,
    marginBottom: 3,
    includeFontPadding: false,
  },

  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.surfaces.lineSoft,
  },

  more: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.surfaces.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  moreText: { fontFamily: fonts.medium, fontSize: 11, color: t.colors.primaryOn },
});
