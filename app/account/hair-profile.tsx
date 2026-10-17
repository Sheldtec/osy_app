import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountShell, Failed, Loading, Panel, SectionLabel } from "@/components/account-ui";
import { Notice, PayBar, SelectField } from "@/components/checkout-ui";
import { Txt } from "@/components/ui";
import {
  getHairProfile,
  HAIR_PROFILE_FIELDS,
  HAIR_PROFILE_LABEL,
  HAIR_PROFILE_MEASUREMENTS,
  saveHairProfile,
  type HairProfile,
  type HairProfileOption,
  type HairProfileField,
} from "@/lib/account-api";
import { moneyBandLabel } from "@/lib/currency";
import { useApproxMoney } from "@/lib/currency-context";
import { ApiError } from "@/lib/http";


/**
 * Hair profile — measurements and preferences.
 *
 * Every field is a choice from a list the SHOP owns: the colour and length
 * options are merged from the live catalogue, so hard-coding them here would
 * offer shades the shop has stopped carrying. The screen renders whatever
 * `options` comes back with and nothing else.
 *
 * Saving is a full replace, because "no preference" is a real answer and a
 * partial update gives no way to express clearing a field.
 */
export default function HairProfileScreen() {
  const insets = useSafeAreaInsets();
  // Above every early return, because this screen has two of them. Only the
  // budget bands use it, and only to READ: what gets saved is the server's
  // own Naira string.
  const approx = useApproxMoney();

  const [values, setValues] = useState<HairProfile>({});
  const [options, setOptions] = useState<Record<string, HairProfileOption[]>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // What the server last confirmed, so the CTA can tell a real edit from none.
  const baseline = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const res = await getHairProfile();
      setValues(res.data ?? {});
      setOptions(res.options ?? {});
      setSavedAt(res.saved_at);
      baseline.current = JSON.stringify(res.data ?? {});
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn’t load your hair profile.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = loaded && JSON.stringify(values) !== baseline.current;

  async function save() {
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const res = await saveHairProfile(values);
      setValues(res.data ?? {});
      setOptions(res.options ?? options);
      setSavedAt(res.saved_at);
      baseline.current = JSON.stringify(res.data ?? {});
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Your profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function field(f: HairProfileField) {
    // An option that carries numeric bounds is a money band (the budget
    // field), and its Naira label is restated in the shopper's currency. The
    // VALUE is left exactly as the server sent it — it is the stored enum and
    // goes back verbatim, so only the wording changes. Everything else is
    // passed through untouched, labels and all.
    const choices = (options[f] ?? []).map((o) =>
      typeof o.min === "number" || typeof o.max === "number"
        ? { ...o, label: moneyBandLabel(o, approx) }
        : o,
    );

    return (
      <SelectField
        account
        key={f}
        style={{ marginTop: 12 }}
        label={HAIR_PROFILE_LABEL[f]}
        value={values[f] ?? ""}
        placeholder="No preference"
        // "No preference" is a real answer, so it is an option rather than an
        // absence — the save is a full replace and must be able to clear it.
        // The rest come through as the server wrote them, labels and all.
        options={[{ value: "", label: "No preference" }, ...choices]}
        onChange={(v) => {
          setValues((prev) => ({ ...prev, [f]: v }));
          setJustSaved(false);
        }}
        bottomInset={insets.bottom}
      />
    );
  }

  if (error && !loaded) {
    return (
      <AccountShell title="Hair profile">
        <Failed message={error} onRetry={() => void load()} />
      </AccountShell>
    );
  }

  if (!loaded) {
    return (
      <AccountShell title="Hair profile">
        <Loading label="Loading your hair profile…" />
      </AccountShell>
    );
  }

  const prefs = HAIR_PROFILE_FIELDS.filter((f) => !HAIR_PROFILE_MEASUREMENTS.includes(f));

  return (
    <AccountShell
      title="Hair profile"
      subtitle="So we can match a piece to you, and cut down the back-and-forth before an order."
      footerSpace={150}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
      footer={
        <PayBar
          caption={savedAt ? `Last saved ${when(savedAt)}` : "Not saved yet"}
          label={saving ? "Saving…" : "Save profile"}
          busy={saving}
          disabled={!dirty}
          bottomInset={insets.bottom}
          onPress={() => void save()}
        />
      }
    >
      <View>
        {justSaved ? (
          <View style={{ marginBottom: 12 }}>
            <Notice tone="success">Saved. We’ll use this when we help you choose.</Notice>
          </View>
        ) : null}
        {saveError ? (
          <View style={{ marginBottom: 12 }}>
            <Notice tone="danger">{saveError}</Notice>
          </View>
        ) : null}
      </View>

      <SectionLabel>MEASUREMENTS</SectionLabel>
      <Panel>
        <Txt tone="body" size={9} style={{ lineHeight: 14 }}>
          Measure with a soft tape, snug but not tight. If you’re not sure, leave it — we’d rather
          ask than guess from a wrong number.
        </Txt>
        {HAIR_PROFILE_MEASUREMENTS.map(field)}
      </Panel>

      <SectionLabel>PREFERENCES</SectionLabel>
      <Panel>{prefs.map(field)}</Panel>

      <Txt tone="body" size={9} style={{ marginTop: 18, lineHeight: 14 }}>
        Only our team sees this, and it is never shown on anything public.
      </Txt>
    </AccountShell>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

