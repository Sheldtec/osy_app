import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AccountShell,
  Divide,
  Empty,
  Failed,
  Line,
  Loading,
  Panel,
  Pill,
  SectionLabel,
  Thumb,
} from "@/components/account-ui";
import { HairImage } from "@/components/hair-image";
import { Txt } from "@/components/ui";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import { useStorefrontSettings } from "@/lib/settings";
import {
  getThriftListing,
  ownersLabel,
  thriftHref,
  thriftSpec,
  type ThriftDetail,
  type ThriftStatus,
} from "@/lib/thrift-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * One pre-loved piece.
 *
 * The spec, the condition, how many owners it has had and who is selling it —
 * the four things that decide whether a second-hand unit is worth buying, and
 * the reason the shop records a traceable code at all.
 *
 * The STATUS is shown rather than assumed. The endpoint hides listings that
 * are in moderation or withdrawn, but it will serve a reserved or sold one, so
 * anybody following an old link is told where the piece went.
 *
 * There is no buy control. Requesting a piece, the escrow and the buyer↔seller
 * thread are not in the app yet, and a button that opened nothing would be
 * worse than the sentence at the foot of this screen.
 */

const STATUS: Record<ThriftStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  pending: { label: "In review", tone: "warn" },
  active: { label: "Available", tone: "ok" },
  reserved: { label: "Reserved", tone: "warn" },
  sold: { label: "Sold", tone: "mute" },
  removed: { label: "Withdrawn", tone: "bad" },
};

export default function ThriftListingScreen() {
  const s = useThemedStyles(makeS);
  const money = useApproxMoney();
  const { features, loading: gating } = useStorefrontSettings();
  const { slug } = useLocalSearchParams<{ slug?: string }>();

  const [listing, setListing] = useState<ThriftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!slug) {
      setError("That listing reference isn’t one we recognise.");
      setRefreshing(false);

      return;
    }

    try {
      setListing(await getThriftListing(slug));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load this listing.");
    } finally {
      setRefreshing(false);
    }
  }, [slug]);

  const open = features.thrift;

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // ---- gates ---------------------------------------------------------------
  if (gating) {
    return (
      <AccountShell title="Pre-loved">
        <Loading label="Opening this listing…" />
      </AccountShell>
    );
  }

  if (!open) {
    return (
      <AccountShell title="Pre-loved" subtitle="The resale market is closed just now.">
        <Empty
          title="Not available"
          body="Our pre-loved market is switched off at the moment, so this listing can’t be shown. Everything else in the shop is open as usual."
          action={{ label: "Browse the shop", onPress: () => router.replace("/shop") }}
        />
      </AccountShell>
    );
  }

  if (error && !listing) {
    return (
      <AccountShell title="Pre-loved">
        <Failed message={error} onRetry={() => void load()} />
      </AccountShell>
    );
  }

  if (!listing) {
    return (
      <AccountShell title="Pre-loved">
        <Loading label="Opening this listing…" />
      </AccountShell>
    );
  }

  const l = listing;
  const st = STATUS[l.status] ?? { label: l.status, tone: "mute" as const };
  const spec = thriftSpec(l);
  const was = l.compare_at;
  const siblings = l.more_from_seller ?? [];

  return (
    <AccountShell
      title={l.title}
      subtitle={l.condition}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      {/* ---- the piece ---- */}
      <Panel padded={false} style={{ overflow: "hidden" }}>
        <View style={s.well}>
          <HairImage src={l.image} seed={l.slug} alt={l.title} monogramSize={110} />
        </View>

        <View style={{ padding: 16 }}>
          <View style={s.pills}>
            <Pill label={st.label} tone={st.tone} />
            <Pill label={ownersLabel(l.owners)} tone="mute" />
          </View>

          {/* The code is what makes this unit traceable, so it sits with the
              piece rather than in a section of its own. */}
          <Text style={s.code} selectable>
            {l.code}
          </Text>

          <View style={s.priceRow}>
            {was !== null && was > l.price ? <Text style={s.was}>{money(was)}</Text> : null}
            <Txt tone="primary" display size={28}>
              {money(l.price)}
            </Txt>
          </View>
          {was !== null && was > l.price ? (
            <Txt tone="body" size={9} style={{ marginTop: 4 }}>
              New, this piece was {money(was)}.
            </Txt>
          ) : null}
        </View>
      </Panel>

      {l.status === "reserved" || l.status === "sold" ? (
        <Panel>
          <Txt tone="body" size={10} style={{ lineHeight: 15 }}>
            {l.status === "sold"
              ? "This piece has already been sold, so it’s here as a record rather than an offer."
              : "A buyer is part-way through this one, so it isn’t open to new offers just now."}
          </Txt>
        </Panel>
      ) : null}

      {/* ---- the spec ---- */}
      {spec.length > 0 || l.category ? (
        <>
          <SectionLabel>THIS PIECE</SectionLabel>
          <Panel>
            {l.length ? <Line label="Length" value={l.length} /> : null}
            {l.colour ? <Line label="Colour" value={l.colour} /> : null}
            {l.density ? <Line label="Density" value={l.density} /> : null}
            {l.preparation ? <Line label="Preparation" value={l.preparation} /> : null}
            {spec.length > 0 ? <Divide /> : null}
            <Line label="Condition" value={l.condition} />
            <Line label="Owners so far" value={String(l.owners)} />
            {l.category ? <Line label="Category" value={titleCase(l.category)} /> : null}
            {/*
             * Said plainly where a missing spec would otherwise read as a gap
             * in the piece rather than a gap in our records.
             */}
            {spec.length === 0 ? (
              <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 14 }}>
                This listing predates our variant records, so the original length and colour
                aren’t on file. The seller can tell you.
              </Txt>
            ) : null}
          </Panel>
        </>
      ) : null}

      {/* ---- the seller's own words ---- */}
      {l.description ? (
        <>
          <SectionLabel>FROM THE OWNER</SectionLabel>
          <Panel>
            <Txt tone="body" size={11} style={{ lineHeight: 17 }}>
              {l.description}
            </Txt>
          </Panel>
        </>
      ) : null}

      {/* ---- the seller ---- */}
      <SectionLabel>SELLER</SectionLabel>
      <Panel>
        <Txt tone="strong" size={12} weight="medium">
          {l.seller ?? "A LUXE customer"}
        </Txt>
        {l.seller_since ? (
          <Txt tone="body" size={9} style={{ marginTop: 4 }}>
            With us since {monthYear(l.seller_since)}
          </Txt>
        ) : null}

        {/* Computed by the server from real listings — not a reputation score
            we invented for the look of it. */}
        {l.seller_listings !== undefined || l.seller_sold !== undefined ? (
          <View style={{ marginTop: 12 }}>
            {l.seller_listings !== undefined ? (
              <Line label="Pieces listed now" value={String(l.seller_listings)} />
            ) : null}
            {l.seller_sold !== undefined ? (
              <Line label="Pieces sold" value={String(l.seller_sold)} />
            ) : null}
          </View>
        ) : null}
      </Panel>

      {/* ---- more from the same seller ---- */}
      {siblings.length > 0 ? (
        <>
          <SectionLabel>ALSO FROM THIS SELLER</SectionLabel>
          <Panel>
            <View style={{ gap: 14 }}>
              {siblings.map((m) => (
                <Pressable
                  key={m.slug}
                  onPress={() => router.push(thriftHref(m.slug))}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.title}. ${m.condition}. ${money(m.price)}`}
                  style={({ pressed }) => [
                    { flexDirection: "row", gap: 12, alignItems: "center" },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Thumb src={m.image} seed={m.slug} alt={m.title} width={46} height={54} radius={12} />
                  <View style={{ flex: 1 }}>
                    <Txt tone="strong" size={11} numberOfLines={1}>
                      {m.title}
                    </Txt>
                    <Txt tone="body" size={9} style={{ marginTop: 3 }} numberOfLines={1}>
                      {m.condition}
                    </Txt>
                  </View>
                  <Txt tone="strong" size={11} weight="medium">
                    {money(m.price)}
                  </Txt>
                  <Txt tone="faint" size={14} style={{ marginTop: -2 }}>
                    ›
                  </Txt>
                </Pressable>
              ))}
            </View>
          </Panel>
        </>
      ) : null}

      {/* ---- what this screen cannot do, said out loud ---- */}
      <Panel>
        <Txt tone="body" size={10} style={{ lineHeight: 16 }}>
          Asking to buy a pre-loved piece isn’t in the app yet. Everything above is what the
          owner listed, and the code travels with the piece.
        </Txt>
      </Panel>

      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/shop"))}
        accessibilityRole="button"
        accessibilityLabel="Back to the pre-loved market"
        style={({ pressed }) => [
          { alignItems: "center", paddingVertical: 16 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Txt tone="primary" size={13} weight="medium">
          Back to pre-loved
        </Txt>
      </Pressable>
    </AccountShell>
  );
}

/** "wigs" → "Wigs". The API's categories are lowercase slugs. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const makeS = (t: Theme) => StyleSheet.create({
  // HairImage fills its parent with `absoluteFill`, so the well has to carry
  // the size. An aspect ratio rather than a fixed height keeps the photo the
  // same shape from a 375pt phone to a large one.
  well: { width: "100%", aspectRatio: 4 / 5, backgroundColor: t.colors.imgBg },

  pills: { flexDirection: "row", gap: 8, alignItems: "center" },

  code: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.8,
    color: t.textInk.strong,
    marginTop: 12,
    includeFontPadding: false,
  },

  priceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 10 },
  was: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: t.textInk.faint,
    textDecorationLine: "line-through",
    marginRight: 10,
    marginBottom: 6,
    includeFontPadding: false,
  },
});
