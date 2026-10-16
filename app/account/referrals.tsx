import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import {
  AccountShell,
  Empty,
  Failed,
  Loading,
  Panel,
  Pill,
  SectionLabel,
} from "@/components/account-ui";
import { GradientButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { naira } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { getReferrals, type ReferralRow, type Referrals } from "@/lib/referrals-api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Invite a friend.
 *
 * Read-only by design — there is no write endpoint. A referral is attached
 * when the friend signs up with the code, and the reward is paid server-side
 * once their first qualifying order is paid. So nothing here claims, retries
 * or predicts: it reports what the server says and offers a refresh.
 *
 * Two figures that look alike and are not:
 *   · `reward_amount` is what an invite pays TODAY, and the shop can change it.
 *   · `row.reward` is what a particular invite ACTUALLY paid, snapshotted at
 *     the time — 0 while it is still pending.
 * Showing today's figure against a pending invite would be a promise the shop
 * has not made.
 */

const STATUS: Record<ReferralRow["status"], { label: string; tone: "ok" | "warn" | "mute" }> = {
  pending: { label: "Awaiting first order", tone: "warn" },
  rewarded: { label: "Rewarded", tone: "ok" },
  void: { label: "Not counted", tone: "mute" },
};

export default function ReferralsScreen() {
  const s = useThemedStyles(makeS);
  const { signedIn } = useAuth();

  const [data, setData] = useState<Referrals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    try {
      setData(await getReferrals());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your invites.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  if (!signedIn) {
    return (
      <AccountShell title="Invite a friend" subtitle="Share your code, earn store credit.">
        <Empty
          title="Sign in to get your code"
          body="A referral code belongs to an account — it's how we know who to pay."
          action={{ label: "Sign in", onPress: () => router.push("/auth") }}
        />
      </AccountShell>
    );
  }

  const invite = data
    ? `Shop OsyGentle with my code ${data.code} — real, verified human hair.`
    : "";

  return (
    <AccountShell
      title="Invite a friend"
      subtitle={
        data
          ? `${data.stats.invited} invited · ${naira(data.stats.earned)} earned`
          : "Share your code, earn store credit."
      }
      onRefresh={() => {
        setRefreshing(true);
        void load(true);
      }}
      refreshing={refreshing}
    >
      {data === null && error === null ? <Loading label="Loading your invites…" /> : null}
      {error && data === null ? <Failed message={error} onRetry={() => void load()} /> : null}

      {data ? (
        <>
          {/* The programme can be paused without the payload going away. */}
          {!data.enabled ? (
            <Panel>
              <Txt tone="strong" size={12} weight="medium">
                Invites are paused
              </Txt>
              <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
                We’ve stopped the referral programme for now. Anything you’ve already earned is
                safe in your wallet.
              </Txt>
            </Panel>
          ) : null}

          {/* ---- the code ---- */}
          <SectionLabel>YOUR CODE</SectionLabel>
          <Panel>
            <Txt tone="strong" display size={32} selectable style={{ letterSpacing: 3 }}>
              {data.code}
            </Txt>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  void Clipboard.setStringAsync(data.code);
                  setCopied(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Copy your referral code"
                style={({ pressed }) => [s.action, pressed && { opacity: 0.75 }]}
              >
                <Text style={s.actionText}>{copied ? "Copied" : "Copy code"}</Text>
              </Pressable>

              <Pressable
                onPress={() => void Share.share({ message: invite }).catch(() => {})}
                accessibilityRole="button"
                accessibilityLabel="Share your referral code"
                style={({ pressed }) => [s.action, s.actionStrong, pressed && { opacity: 0.75 }]}
              >
                <Text style={[s.actionText, { color: "#FFFFFF" }]}>Share</Text>
              </Pressable>
            </View>
          </Panel>

          {/* ---- what it pays ---- */}
          <SectionLabel>HOW IT WORKS</SectionLabel>
          <Panel>
            <Step
              n={1}
              text={`Your friend signs up with ${data.code}.`}
            />
            <Step
              n={2}
              text={`They place their first order of ${naira(data.min_order)} or more, and pay for it.`}
            />
            <Step
              n={3}
              text={
                data.referee_amount > 0
                  ? `You get ${naira(data.reward_amount)} in store credit, and they get ${naira(data.referee_amount)}.`
                  : `${naira(data.reward_amount)} in store credit lands in your wallet.`
              }
              last
            />

            <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 13 }}>
              Referral credit is earned income, so it is one of the few things you can cash out.
            </Txt>
          </Panel>

          {/* ---- the numbers ---- */}
          <SectionLabel>YOUR INVITES</SectionLabel>
          <Panel>
            <View style={s.stats}>
              <Stat label="Invited" value={String(data.stats.invited)} />
              <Stat label="Waiting" value={String(data.stats.pending)} />
              <Stat label="Rewarded" value={String(data.stats.rewarded)} />
            </View>

            <View style={s.earned}>
              <Text style={s.earnedLabel}>EARNED SO FAR</Text>
              <Txt tone="strong" display size={26} style={{ marginTop: 4 }}>
                {naira(data.stats.earned)}
              </Txt>
            </View>
          </Panel>

          {/* ---- who ---- */}
          {data.referrals.length === 0 ? (
            <Empty
              title="No one yet"
              body={
                data.enabled
                  ? "Send your code to someone who'd love the hair. You'll see them here the moment they join."
                  : "Nobody has used your code."
              }
            />
          ) : null}

          {data.referrals.map((row, i) => {
            const st = STATUS[row.status] ?? { label: row.status, tone: "mute" as const };

            return (
              <Panel key={`${row.name ?? "friend"}-${row.at ?? i}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Txt tone="strong" size={12} weight="medium">
                      {row.name || "A friend"}
                    </Txt>
                    <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                      Joined {stamp(row.at)}
                      {row.qualified_at ? ` · ordered ${stamp(row.qualified_at)}` : ""}
                    </Txt>
                  </View>
                  <Pill label={st.label} tone={st.tone} />
                </View>

                {/* Only ever the amount actually paid — never today's setting. */}
                {row.reward > 0 ? (
                  <Txt tone="strong" display size={17} style={{ marginTop: 10 }}>
                    + {naira(row.reward)}
                  </Txt>
                ) : null}
              </Panel>
            );
          })}

          {data.stats.invited > data.referrals.length ? (
            <Txt tone="body" size={9} center style={{ marginTop: 14, lineHeight: 13 }}>
              Showing your {data.referrals.length} most recent invites of {data.stats.invited}.
            </Txt>
          ) : null}

          {data.stats.earned > 0 ? (
            <GradientButton
              label="Go to my wallet"
              style={{ marginTop: 20 }}
              onPress={() => router.push("/wallet")}
            />
          ) : null}
        </>
      ) : null}
    </AccountShell>
  );
}

function Step({ n, text, last }: { n: number; text: string; last?: boolean }) {
  const s = useThemedStyles(makeS);
  return (
    <View style={[s.step, last && { marginBottom: 0 }]}>
      <View style={s.stepDot}>
        <Text style={s.stepNum}>{n}</Text>
      </View>
      <Txt tone="body" size={11} style={{ flex: 1, lineHeight: 17 }}>
        {text}
      </Txt>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const s = useThemedStyles(makeS);
  return (
    <View style={{ flex: 1 }}>
      <Txt tone="strong" display size={22}>
        {value}
      </Txt>
      <Text style={s.statLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const makeS = (t: Theme) => StyleSheet.create({
  action: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  actionStrong: { backgroundColor: t.colors.primary },
  actionText: { fontFamily: fonts.medium, fontSize: 12, color: t.colors.primaryOn },

  step: { flexDirection: "row", gap: 12, marginBottom: 14 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.colors.primaryCont,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: { fontFamily: fonts.medium, fontSize: 10, color: t.colors.primaryOn },

  stats: { flexDirection: "row", gap: 12 },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: t.textInk.faint,
    marginTop: 4,
  },

  earned: {
    marginTop: 18,
    backgroundColor: t.surfaces.cart,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  earnedLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 1.4,
    color: t.textInk.faint,
  },
});
