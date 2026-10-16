import { colors, glassNav, surfaces, textInk } from "./tokens";

/**
 * Light and dark, as two complete palettes.
 *
 * The shape is IDENTICAL to the existing token objects — same keys, same
 * meanings — so a screen converts by reading them off a theme instead of
 * importing them, and never by renaming anything. `lightTheme` is literally
 * the tokens that shipped, so light mode cannot drift while dark is added.
 *
 * DARK IS NOT AN INVERSION. This brand is purple, gold and photographic, and
 * flipping the hex values would give grey cards, muddy gold and a brand purple
 * too dark to read against its own background. Three rules shaped it:
 *
 *   1. The GROUNDS carry a purple cast rather than being neutral black, so the
 *      app still looks like itself with the lights off.
 *   2. Cards sit ABOVE the ground rather than below it — in light the card is
 *      white on near-white, in dark it is lifted, because there are no shadows
 *      on in-flow surfaces (owner direction 2026-09-03) and the only thing
 *      left to separate a card from the page is its value.
 *   3. BRAND purple is kept for fills, but anything purple that has to be READ
 *      on a dark ground is lifted to `primaryOn`. #5C2A7F on #141017 is around
 *      1.6:1 — unreadable. The lifted tone clears 7:1.
 */

/**
 * The same keys, widened to `string`.
 *
 * The token objects are `as const`, so `typeof colors` is a type whose `canvas`
 * is the literal `"#F3F1F4"` — not "a colour". Without widening, the dark
 * palette could only be assigned the light palette's exact hex values, which
 * is the one thing it must not be.
 */
type Palette<T> = { [K in keyof T]: string };

export interface Theme {
  /** True when this is the dark palette. Prefer a token over asking this. */
  dark: boolean;
  colors: Palette<typeof colors> & {
    /**
     * Brand purple that is legible AS TEXT on this theme's grounds.
     *
     * In light it is `primary` itself; in dark it is lifted. Use it for purple
     * TEXT and ICONS. Keep `primary` for fills, where the white on top of it
     * provides the contrast instead.
     */
    primaryOn: string;
  };
  surfaces: Palette<typeof surfaces>;
  textInk: Palette<typeof textInk>;
  glassNav: Palette<typeof glassNav>;
}

export const lightTheme: Theme = {
  dark: false,
  colors: { ...colors, primaryOn: colors.primary },
  surfaces,
  textInk,
  glassNav,
};

export const darkTheme: Theme = {
  dark: true,
  colors: {
    ...colors,

    // Fills keep the brand purple; white text on it is what carries contrast.
    primary: "#6A3290",
    primaryDark: "#3D1A57",
    primaryLight: "#8A52B0",
    // Readable purple for text and icons — see rule 3.
    primaryOn: "#C9A4E6",
    // The "selected tint" well. In light this is a pale lilac ON white; in
    // dark it has to read as raised on an already-dark card.
    primaryCont: "#33244A",

    // Gold survives the move almost untouched — it was always a warm accent
    // against dark bands (the night section, the hero) and reads better here
    // than it does on white.
    gold1: "#E3CFA6",
    gold2: "#C9A875",
    champ: "#C7B39A",

    // Type.
    ink: "#F4F1F7",
    ink2: "#BDB4C6",
    muted: "#857D8F",

    canvas: "#121016",
    // Cards sit ABOVE the ground — see rule 2.
    surface: "#1E1826",
    imgBg: "#272031",
    imgBg2: "#2A2420",
    night: "#0D0912",

    // Status: the FILL darkens, the INK lifts, so both stay legible.
    success: "#5FB389",
    successBg: "#17291F",
    danger: "#E8736A",
    dangerBg: "#30191A",
  },

  surfaces: {
    // Per-screen grounds, each keeping the hue its light counterpart had.
    home: "#121016",
    cart: "#131118",
    product: "#141019",
    checkout: "#131018",
    auth: "#131018",

    // Hairlines. A 1px line that is lighter than its ground, not darker.
    line: "#2C2437",
    lineWarm: "#2E2830",
    lineProduct: "#2C2435",
    lineCheckout: "#2B2434",
    lineSearch: "#332741",
    lineField: "#2C2536",
    lineSoft: "#282231",

    chipActive: "#3A2851",
    searchIcon: "rgba(58,40,81,0.9)",
    stepperTrack: "#272031",
    actionTint: "#2A2237",
    segmentTrack: "#262030",
    verifiedTint: "#36264C",
    noteTint: "#2E2718",

    handle: "#473D58",
    offerTint: "#33261B",
    cartFade: "rgba(19,17,24,0)",

    stockBg: "#16291D",
    stockInk: "#6FC191",
  },

  textInk: {
    strong: "#F5F2F8",
    body: "#A9A2B4",
    soft: "#A49CAF",
    faint: "#7D7589",
    nav: "#A7A0B1",
  },

  glassNav: {
    // Near-opaque, matching the light bar's intent: a solid surface, not glass.
    surface: "rgba(26,21,33,0.97)",
    activeFill: "#38264E",
  },
};
