import { Platform, type ViewStyle } from "react-native";

/**
 * OsyGentle / LUXE design tokens — locked from the Figma design system.
 * Import from here; never hard-code colors or radii in screens.
 */
export const colors = {
  primary: "#5C2A7F",
  primaryDark: "#3D1A57",
  primaryLight: "#6A3290",
  primaryCont: "#EEE6F3",
  gold1: "#DEC79B",
  gold2: "#B7986A",
  champ: "#C7B39A",
  ink: "#1C1420",
  ink2: "#4A4151",
  muted: "#9C94A1",
  canvas: "#F3F1F4",
  surface: "#FFFFFF",
  imgBg: "#EFEAF1",
  imgBg2: "#F5F0E8",
  night: "#241830",
  success: "#3B7A5E",
  successBg: "#EAF3EE",
  danger: "#C0473E",
  dangerBg: "#FBEBEA",
} as const;

export const radius = { chip: 17, control: 24, card: 24, sheet: 26, nav: 32 } as const;

export const spacing = (n: number) => n * 8;

/** Soft-morphism card shadow — gentle and diffuse, never harsh. */
export const softShadow = Platform.select({
  ios: {
    shadowColor: "#221430",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  android: { elevation: 4 },
  // react-native-web deprecates the shadow* props and warns on every render.
  // Native RN 0.86 does not, so only the web branch changes form.
  web: { boxShadow: "0px 10px 24px rgba(34, 20, 48, 0.08)" },
  default: {},
});

/** `#RRGGBB` + alpha as a CSS colour, for boxShadow on web. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);

  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * One elevation shadow, for the surfaces that float over content.
 *
 * The NATIVE branch is byte-identical to what these styles set before: both
 * `shadow*` and `elevation`. That matters — several call sites hand-tuned their
 * Android value (the product sheet uses 0, because Android draws elevation as a
 * halo on every side and at 12 it painted a grey band across the page), and
 * rewriting them would change how the app looks on a phone.
 *
 * Web gets `boxShadow` INSTEAD of shadow*, because react-native-web — and only
 * react-native-web — deprecates those props and warns on every render. Native
 * React Native 0.86 still declares `shadowColor` with no deprecation, so
 * converting the native styles would be changing real rendering to silence a
 * warning that never appears on a device.
 */
export function shadow(spec: {
  color: string;
  opacity: number;
  radius: number;
  /** Positive casts downward, negative upward (bars that sit below content). */
  offsetY: number;
  elevation: number;
}): ViewStyle {
  if (Platform.OS === "web") {
    return {
      boxShadow: `0px ${spec.offsetY}px ${spec.radius}px ${rgba(spec.color, spec.opacity)}`,
    };
  }

  return {
    shadowColor: spec.color,
    shadowOpacity: spec.opacity,
    shadowRadius: spec.radius,
    shadowOffset: { width: 0, height: spec.offsetY },
    elevation: spec.elevation,
  };
}

/** Brand CTA gradient stops (use with expo-linear-gradient). */
export const ctaGradient = ["#6A3290", "#3D1A57"] as const;
export const goldGradient = ["#DEC79B", "#B7986A"] as const;

/** Font families — load with @expo-google-fonts/fraunces + dm-sans. */
export const fonts = {
  display: "Fraunces_600SemiBold",
  displayLight: "Fraunces_300Light",
  body: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  bold: "DMSans_700Bold",
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Additions from the approved soft-morphism re-skin (Figma file
 * XfTZL6URJIOIXI4tmkEsGV, frames "Refined · 1/2/3/18").
 *
 * These are the NEUTRALS the re-skin introduces — page grounds, hairlines and
 * the secondary text greys. Brand colours are deliberately NOT re-declared
 * here: the frames drift between #5C2185 / #5C2B7A / #5C2A7F for the same
 * purple, and shipping three near-identical brand purples would be worse than
 * one. Screens use `colors.primary` for all of them.
 * ──────────────────────────────────────────────────────────────────────────── */
export const surfaces = {
  /** Per-screen page grounds, straight from the frames. */
  home: "#FCFBFC",
  cart: "#FBFAFD",
  product: "#F9F7FA",
  checkout: "#FDFCFE",
  auth: "#FDFCFE",
  /** Hairline borders. `line` is the workhorse; the others are as-designed. */
  line: "#EBE5F0",
  lineWarm: "#E5E0DE",
  lineProduct: "#E5DEE8",
  lineCheckout: "#E6E0EA",
  lineSearch: "#E7DBEB",
  lineField: "#E6E0EA",
  lineSoft: "#ECE7EC",
  /** Tints. */
  chipActive: "#F0E3F7",
  searchIcon: "rgba(237,222,245,0.9)",
  stepperTrack: "#F6F2F9",
  actionTint: "#F5F0FA",
  segmentTrack: "#F0EBF2",
  verifiedTint: "#F0E5F7",
  noteTint: "#F6F0E7",
  /**
   * A visible-but-quiet grey — drag handles, empty rating stars. It has to read
   * AGAINST the card it sits on, so in dark it lifts rather than darkens.
   */
  handle: "#D6CFD9",
  /** Warm well behind an offer/promo icon. */
  offerTint: "#FBEFE6",
  /**
   * `cart` at zero alpha, for the sticky bar's fade.
   *
   * It cannot be plain `transparent`: Android interpolates a gradient through
   * RGB as well as alpha, so fading from transparent BLACK (what `transparent`
   * is) to a pale ground draws a grey bruise across the middle — and fading
   * from transparent white would do the same thing in reverse on a dark one.
   */
  cartFade: "rgba(251,250,253,0)",
  /** Status. */
  stockBg: "#E8F7ED",
  stockInk: "#267A40",
} as const;

/** Secondary text greys used across the re-skinned frames. */
export const textInk = {
  strong: "#1A131F",
  body: "#6E6675",
  soft: "#6B6373",
  faint: "#9B95A1",
  nav: "#574F5C",
} as const;

/** The frosted floating nav bar. */
/**
 * Owner direction 2026-09-03: the nav is a SOLID surface, no gradient and no
 * blur. expo-blur does not blur on Android at all (it falls back to a plain
 * translucent view), so the frame's glass bar was a see-through wash with
 * content bleeding through it, and looked different on every screen because
 * every screen has a different background. One near-opaque white, everywhere.
 */
export const glassNav = {
  surface: "rgba(255,255,255,0.97)",
  /** Active tab tint — flat, no gradient. */
  activeFill: "#EFE4F6",
} as const;

/** The three hero carousel slides, each with its own gradient (107° in Figma). */
export const heroSlides = [
  { from: "#2E0B40", mid: "#521A66", to: "#783D6B" },
  { from: "#3D1433", mid: "#78334D", to: "#A86659" },
  { from: "#0E0B11", mid: "#2E123D", to: "#5E2178" },
] as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Owner direction, 2026-09-03: tighter gutters and NO shadows on in-flow
 * surfaces. This overrides the soft-morphism surface rules in CLAUDE.md and
 * the shadows drawn on the Figma frames — do not "restore" them.
 *
 * `softShadow` above is kept (it is the kit's export) but is now reserved for
 * elements that genuinely float OVER scrolling content — the glass nav, the
 * sticky purchase/checkout bars, the product sheet. Cards, chips, circles and
 * buttons are flat.
 * ──────────────────────────────────────────────────────────────────────────── */
export const layout = {
  /** Page gutter. Was 24 (the frame's); the owner asked for less padding. */
  gutter: 16,
  /** Gap between the two product cards in a grid row. */
  gap: 12,
} as const;
