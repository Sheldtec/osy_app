import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountShell, Empty, Failed, Loading, Panel, Pill, SectionLabel } from "@/components/account-ui";
import { Field, Notice, SelectField } from "@/components/checkout-ui";
import { GradientButton, Txt } from "@/components/ui";
import {
  applyForVip,
  getVipStatus,
  payVipFee,
  type VipStatus,
} from "@/lib/account-api";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";
import type { Theme } from "@/theme/theme";
import { useTheme } from "@/theme/theme-context";

/**
 * OG VIP — the trade membership.
 *
 * Not a loyalty tier you opt into: there is a spend gate, a business
 * application a person reviews, and a fee paid from the wallet once approved.
 * The screen shows all three stages because a customer who applies and then
 * sees nothing assumes it failed.
 *
 * Eligibility is recomputed server-side from the customer's own orders. The
 * figure here is shown so they know where they stand; it never decides
 * anything, so the Apply button is left to the server to refuse.
 */
export default function VipScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useApproxMoney();

  const [vip, setVip] = useState<VipStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [form, setForm] = useState({ business_name: "", business_type: "", cac_number: "", phone: "" });
  const [applying, setApplying] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      setVip(await getVipStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your membership.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    setApplying(true);
    setFormError(null);
    setFieldErrors({});
    try {
      setVip(
        await applyForVip({
          business_name: form.business_name.trim(),
          business_type: form.business_type,
          ...(form.cac_number.trim() ? { cac_number: form.cac_number.trim() } : {}),
          phone: form.phone.trim(),
        }),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors({
          business_name: err.fieldError("business_name") ?? "",
          business_type: err.fieldError("business_type") ?? "",
          cac_number: err.fieldError("cac_number") ?? "",
          phone: err.fieldError("phone") ?? "",
        });
        setFormError(err.fields ? null : err.message);
      } else {
        setFormError("Your application could not be sent.");
      }
    } finally {
      setApplying(false);
    }
  }

  async function payFee() {
    setPaying(true);
    setFormError(null);
    try {
      setVip(await payVipFee());
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "The fee could not be paid.");
    } finally {
      setPaying(false);
    }
  }

  if (error && !vip) {
    return (
      <AccountShell title="OG VIP">
        <Failed message={error} onRetry={() => void load()} />
      </AccountShell>
    );
  }

  if (!vip) {
    return (
      <AccountShell title="OG VIP">
        <Loading label="Loading your membership…" />
      </AccountShell>
    );
  }

  const app = vip.application;
  const openApp = app && !app.cancelled_at && app.status !== "rejected" && !vip.is_vip;
  const feeDue = (app?.fee_due ?? 0) > 0 && !app?.paid_at;
  const progress = vip.min_spend > 0 ? Math.min(1, vip.spend / vip.min_spend) : 1;

  return (
    <AccountShell
      title="OG VIP"
      subtitle="Our trade membership, for stylists and salons buying for their own clients."
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      {!vip.enabled && !vip.is_vip ? (
        <Empty
          title="Membership is closed"
          body="We’re not taking new OG VIP members at the moment. Check back — or ask us and we’ll tell you when it opens."
          action={{ label: "Back to shop", onPress: () => router.replace("/shop") }}
        />
      ) : (
        <View>
          {/* ---- member ---- */}
          {vip.is_vip ? (
            <Panel style={{ backgroundColor: theme.colors.night, borderColor: theme.colors.night }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Txt size={10.5} weight="medium" style={{ color: theme.colors.gold1, letterSpacing: 2, flex: 1 }}>
                  OG VIP MEMBER
                </Txt>
              </View>
              <Txt display size={22} style={{ color: "#FFFFFF", marginTop: 12 }}>
                You’re in.
              </Txt>
              {vip.vip_since ? (
                <Txt size={10} style={{ color: "#CFC3DA", marginTop: 8 }}>
                  Member since {when(vip.vip_since)}
                </Txt>
              ) : null}
            </Panel>
          ) : null}

          {/* ---- what it gets you ---- */}
          {vip.perks?.length ? (
            <Panel>
              <SectionLabel>WHAT MEMBERS GET</SectionLabel>
              <View style={{ marginTop: 10, gap: 8 }}>
                {vip.perks.map((p) => (
                  <View key={p} style={{ flexDirection: "row", gap: 9 }}>
                    <Txt tone="gold" size={13}>
                      ◆
                    </Txt>
                    <Txt tone="body" size={10} style={{ flex: 1, lineHeight: 15 }}>
                      {p}
                    </Txt>
                  </View>
                ))}
              </View>
            </Panel>
          ) : null}

          {/* ---- the spend gate ---- */}
          {!vip.is_vip ? (
            <Panel>
              <SectionLabel>ELIGIBILITY</SectionLabel>
              <Txt tone="body" size={10} style={{ marginTop: 10, lineHeight: 15 }}>
                Membership opens once you’ve spent {money(vip.min_spend)} with us.
              </Txt>

              <View style={track(theme)}>
                <View style={[fill(theme), { width: `${Math.round(progress * 100)}%` }]} />
              </View>

              <View style={{ flexDirection: "row", marginTop: 8 }}>
                <Txt tone="strong" size={11} weight="medium" style={{ flex: 1 }}>
                  {money(vip.spend)} so far
                </Txt>
                <Txt tone="body" size={9}>
                  {vip.eligible ? "Eligible" : `${money(Math.max(0, vip.min_spend - vip.spend))} to go`}
                </Txt>
              </View>
            </Panel>
          ) : null}

          {/* ---- application state ---- */}
          {openApp && app ? (
            <Panel>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                <SectionLabel>YOUR APPLICATION</SectionLabel>
                <View style={{ flex: 1 }} />
                <Pill label={app.status} tone={app.status === "approved" ? "ok" : "warn"} />
              </View>

              <Txt tone="strong" size={11} weight="medium">
                {app.business_name}
              </Txt>
              {app.business_type ? (
                <Txt tone="body" size={9} style={{ marginTop: 4 }}>
                  {app.business_type}
                </Txt>
              ) : null}
              {app.submitted_at ? (
                <Txt tone="body" size={9} style={{ marginTop: 6 }}>
                  Sent {when(app.submitted_at)}
                </Txt>
              ) : null}

              {app.decision_note ? (
                <View style={{ marginTop: 12 }}>
                  <Notice tone="info">{app.decision_note}</Notice>
                </View>
              ) : null}

              {feeDue ? (
                <View style={{ marginTop: 14 }}>
                  <Notice tone="info">
                    Approved. The membership fee of {money(app.fee_due ?? 0)} comes out of your
                    wallet to finish joining.
                  </Notice>
                  <GradientButton
                    label={paying ? "Paying…" : `Pay ${money(app.fee_due ?? 0)} from wallet`}
                    disabled={paying}
                    style={{ marginTop: 14 }}
                    onPress={() => void payFee()}
                  />
                </View>
              ) : (
                <Txt tone="body" size={9} style={{ marginTop: 14, lineHeight: 14 }}>
                  A member of our team reviews every application by hand. We’ll let you know.
                </Txt>
              )}
            </Panel>
          ) : null}

          {/* ---- a rejected or cancelled application ---- */}
          {app && !openApp && !vip.is_vip ? (
            <Notice tone="info">
              {app.cancelled_at
                ? `Your earlier application was withdrawn${app.cancel_reason ? ` — ${app.cancel_reason}` : ""}.`
                : `Your earlier application wasn’t approved${app.decision_note ? ` — ${app.decision_note}` : ""}.`}
              {app.fee_refunded ? ` ${money(app.fee_refunded)} was returned to your wallet.` : ""}
            </Notice>
          ) : null}

          {/* ---- apply ---- */}
          {!vip.is_vip && !openApp ? (
            <Panel>
              <SectionLabel>APPLY</SectionLabel>
              <Txt tone="body" size={9} style={{ marginTop: 10, lineHeight: 14 }}>
                Tell us about your business. There’s a {money(vip.fee)} membership fee, paid from
                your wallet only after you’re approved.
              </Txt>

              <Field
                account
                style={{ marginTop: 14 }}
                label="Business name"
                value={form.business_name}
                onChangeText={(v) => setForm((f) => ({ ...f, business_name: v }))}
                error={fieldErrors.business_name || undefined}
              />

              <SelectField
                account
                style={{ marginTop: 12 }}
                label="Business type"
                value={form.business_type}
                placeholder="Choose one…"
                options={(vip.business_types ?? []).map((t) => ({ value: t, label: t }))}
                onChange={(v) => setForm((f) => ({ ...f, business_type: v }))}
                error={fieldErrors.business_type || undefined}
                bottomInset={insets.bottom}
              />

              <Field
                account
                style={{ marginTop: 12 }}
                label="CAC number"
                value={form.cac_number}
                onChangeText={(v) => setForm((f) => ({ ...f, cac_number: v }))}
                placeholder="Optional"
                autoCapitalize="characters"
                hint="If your business is registered. Leave blank if not."
                error={fieldErrors.cac_number || undefined}
              />

              <Field
                account
                style={{ marginTop: 12 }}
                label="Phone"
                value={form.phone}
                onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                placeholder="+234 800 000 0000"
                keyboardType="phone-pad"
                error={fieldErrors.phone || undefined}
              />

              {formError ? (
                <View style={{ marginTop: 14 }}>
                  <Notice tone="danger">{formError}</Notice>
                </View>
              ) : null}

              <GradientButton
                label={applying ? "Sending…" : "Send application"}
                disabled={applying || !form.business_name.trim() || !form.business_type || !form.phone.trim()}
                style={{ marginTop: 18 }}
                onPress={() => void apply()}
              />

              {!vip.eligible ? (
                <Txt tone="body" size={9} center style={{ marginTop: 14, lineHeight: 14 }}>
                  You can send this now — we’ll hold it until you reach {money(vip.min_spend)}.
                </Txt>
              ) : null}
            </Panel>
          ) : null}

          <Pressable
            onPress={() => router.push("/wallet")}
            accessibilityRole="button"
            style={({ pressed }) => [{ alignItems: "center", paddingVertical: 14 }, pressed && { opacity: 0.7 }]}
          >
            <Txt tone="primary" size={11} weight="medium">
              Go to my wallet
            </Txt>
          </Pressable>
        </View>
      )}
    </AccountShell>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const track = (t: Theme) => ({
  height: 7,
  borderRadius: 3,
  backgroundColor: t.surfaces.segmentTrack,
  marginTop: 14,
  overflow: "hidden" as const,
});

const fill = (t: Theme) => ({
  height: 7,
  borderRadius: 3,
  backgroundColor: t.colors.primary,
});
