import { StyleSheet, Pressable, View } from "react-native";

import { AccountShell, Panel, SectionLabel } from "@/components/account-ui";
import { Txt } from "@/components/ui";
import type { Theme } from "@/theme/theme";
import { useTheme, useThemeMode, useThemedStyles, type ThemeMode } from "@/theme/theme-context";

/**
 * Appearance — Light, System or Dark.
 *
 * LIGHT IS THE DEFAULT, and that is a decision rather than an oversight: the
 * shop was designed on pale grounds — the editorial hero, the gold overlines,
 * the arched product photography — and that is what a first-time opener should
 * see. "System" is here for people who want the app to follow their phone, not
 * because everyone is assumed to.
 *
 * Each option previews itself: the swatch beside it is drawn in the palette it
 * would switch to, so the choice can be made without making it first. The
 * change applies on tap — there is no Save button, because there is nothing to
 * get wrong and the whole screen is the preview.
 */

const OPTIONS: { mode: ThemeMode; label: string; detail: string }[] = [
  {
    mode: "light",
    label: "Light",
    detail: "Pale grounds and gold accents — how the shop was designed.",
  },
  {
    mode: "system",
    label: "System",
    detail: "Follows your phone, and changes with it.",
  },
  {
    mode: "dark",
    label: "Dark",
    detail: "Deep plum grounds, lifted cards, the same gold.",
  },
];

export default function AppearanceScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { mode, setMode, resolved } = useThemeMode();

  return (
    <AccountShell
      title="Appearance"
      subtitle={
        mode === "system"
          ? `Following your phone — ${resolved} right now`
          : `${mode === "dark" ? "Dark" : "Light"} on this device`
      }
    >
      <SectionLabel>THEME</SectionLabel>
      <Panel padded={false}>
        {OPTIONS.map((opt, i) => {
          const active = mode === opt.mode;

          return (
            <Pressable
              key={opt.mode}
              onPress={() => setMode(opt.mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${opt.label}. ${opt.detail}`}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <Swatch mode={opt.mode} />

              <View style={{ flex: 1 }}>
                <Txt tone="strong" weight="medium" size={11.5}>
                  {opt.label}
                </Txt>
                <Txt tone="body" size={9} style={{ marginTop: 4, lineHeight: 13 }}>
                  {opt.detail}
                </Txt>
              </View>

              {/* A ring that fills, not a tick glyph: it reads at a glance and
                  needs no font that might not have loaded. */}
              <View style={[styles.radio, active && styles.radioOn]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>

              {i < OPTIONS.length - 1 ? <View style={styles.divider} /> : null}
            </Pressable>
          );
        })}
      </Panel>

      <Txt tone="faint" size={9} style={{ marginTop: 14, lineHeight: 14 }}>
        Your choice is kept on this device, so it stays put the next time you open the app. It
        doesn’t travel with your account.
      </Txt>

      {/* Honest about the one thing a theme cannot change. */}
      <SectionLabel style={{ marginTop: 28 }}>WHAT STAYS THE SAME</SectionLabel>
      <Panel>
        <Txt tone="body" size={10} style={{ lineHeight: 15 }}>
          Product photography is shown as shot, so pieces look the same in either theme — the point
          of a hair shop is that you can see the hair. Prices, codes and your order history are
          untouched by this setting.
        </Txt>
      </Panel>
    </AccountShell>
  );
}

/**
 * A two-tone chip drawn in the palette the option would apply.
 *
 * "System" shows both halves, which is the only honest preview of a setting
 * whose answer depends on the phone. The colours are literals rather than
 * tokens on purpose: a preview of the OTHER theme cannot come from the active
 * one, and these are the two grounds and the two card values from `theme.ts`.
 */
function Swatch({ mode }: { mode: ThemeMode }) {
  const styles = useThemedStyles(makeStyles);

  const light = (
    <View style={[styles.half, { backgroundColor: "#F3F1F4" }]}>
      <View style={[styles.card, { backgroundColor: "#FFFFFF", borderColor: "#EBE5F0" }]} />
    </View>
  );
  const dark = (
    <View style={[styles.half, { backgroundColor: "#121016" }]}>
      <View style={[styles.card, { backgroundColor: "#1E1826", borderColor: "#2C2437" }]} />
    </View>
  );

  return (
    <View style={styles.swatch}>
      {mode === "dark" ? dark : light}
      {mode === "system" ? dark : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
    divider: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 0,
      height: 1,
      backgroundColor: t.surfaces.lineSoft,
    },

    swatch: {
      width: 44,
      height: 44,
      borderRadius: 12,
      overflow: "hidden",
      flexDirection: "row",
      borderWidth: 1,
      borderColor: t.surfaces.line,
    },
    half: { flex: 1, padding: 5, justifyContent: "flex-end" },
    card: { height: 14, borderRadius: 4, borderWidth: 1 },

    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.surfaces.line,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: t.colors.primaryOn },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.colors.primaryOn,
    },
  });
