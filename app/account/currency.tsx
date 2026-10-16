import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AccountShell, Panel, SectionLabel } from "@/components/account-ui";
import { Txt } from "@/components/ui";
import {
  CHARGED_IN_NAIRA,
  CURRENCIES,
  formatMoney,
  type CurrencyCode,
} from "@/lib/currency";
import { useCurrency } from "@/lib/currency-context";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Pick the currency prices are SHOWN in.
 *
 * The shop prices and charges in Naira; this only changes what you read. That
 * sentence sits under the list UNCONDITIONALLY — not revealed once a foreign
 * currency is chosen — because the moment to tell someone they will be billed
 * in Naira is before they choose, not after.
 *
 * A sample amount is converted live beside each option, so the choice is made
 * against a real figure rather than a flag and a code.
 */

/** A real catalogue price, so the preview means something. */
const SAMPLE = 220_000;

export default function CurrencyScreen() {
  const s = useThemedStyles(makeS);
  const { code, setCode, rates, source } = useCurrency();
  const [justPicked, setJustPicked] = useState<CurrencyCode | null>(null);

  return (
    <AccountShell
      title="Currency"
      subtitle="What prices are shown in across the app."
    >
      <SectionLabel>SHOW PRICES IN</SectionLabel>
      <Panel padded={false}>
        {CURRENCIES.map((c, i) => {
          const on = c.code === code;

          return (
            <Pressable
              key={c.code}
              onPress={() => {
                setCode(c.code);
                setJustPicked(c.code);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${c.name}. Example: ${formatMoney(SAMPLE, c.code, rates?.rates)}`}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}
            >
              <View style={[s.radio, on && s.radioOn]}>
                {on ? <View style={s.dot} /> : null}
              </View>

              <View style={{ flex: 1 }}>
                <Txt tone="strong" weight={on ? "medium" : undefined} size={12}>
                  {c.name}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 3 }}>
                  {c.code} · {c.symbol}
                </Txt>
              </View>

              {/* The same sample through the same formatter the app uses. */}
              <Txt tone="body" size={11}>
                {formatMoney(SAMPLE, c.code, rates?.rates)}
              </Txt>

              {i < CURRENCIES.length - 1 ? <View style={s.divider} /> : null}
            </Pressable>
          );
        })}
      </Panel>

      {/* Unconditional. The promise is the same whichever row is selected. */}
      <Txt tone="body" size={10} style={{ marginTop: 14, lineHeight: 15 }}>
        {CHARGED_IN_NAIRA}
      </Txt>

      <Panel style={{ marginTop: 18 }}>
        <Txt tone="strong" size={12} weight="medium">
          What this does and doesn’t change
        </Txt>
        <Txt tone="body" size={10} style={{ marginTop: 8, lineHeight: 16 }}>
          Catalogue prices, your saved pieces and past order totals are converted for reading, and
          a converted figure always carries a “≈”. Anything you are actually paying — your bag
          total, a wallet top-up, a cash-out — stays in Naira, because that is the amount that
          reaches your bank.
        </Txt>
      </Panel>

      {/* Stale rates are a real condition, not a hypothetical: the server
          falls back to a static table whenever the FX feed is unreachable. */}
      {source === "fallback" ? (
        <Panel style={{ marginTop: 16 }}>
          <Txt tone="strong" size={12} weight="medium">
            Rates may be out of date
          </Txt>
          <Txt tone="body" size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            We couldn’t reach our exchange-rate source, so the converted figures are rough. Naira
            prices are unaffected.
          </Txt>
        </Panel>
      ) : null}

      {justPicked && justPicked !== "NGN" ? (
        <Txt tone="body" size={9} center style={{ marginTop: 16, lineHeight: 13 }}>
          Showing prices in {justPicked}. You’ll still be charged in Naira.
        </Txt>
      ) : null}

      {rates?.fetched_at ? (
        <Text style={s.stamp}>Rates updated {stamp(rates.fetched_at)}</Text>
      ) : null}
    </AccountShell>
  );
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";

  const hours = Math.round((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const makeS = (t: Theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  divider: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    height: 1,
    backgroundColor: t.surfaces.lineSoft,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: t.surfaces.lineField,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: t.colors.primaryOn },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary },

  stamp: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: t.textInk.faint,
    textAlign: "center",
    marginTop: 18,
  },
});
