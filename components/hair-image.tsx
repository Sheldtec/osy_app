import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { resolveImage } from "@/lib/api";
import type { Theme } from "@/theme/theme";
import { useThemedStyles } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

/**
 * Product imagery.
 *
 * Real photo when the API gives one; otherwise the tonal-gradient placeholder
 * with a faint serif monogram — never a grey box (CLAUDE.md → Conventions).
 * The tint is derived from the seed, so a given product looks the same across
 * sessions and matches the website's placeholder for the same item.
 */

const TINTS: [string, string][] = [
  ["#EFE7F3", "#CDB8DB"], // plum
  ["#F7F3EE", "#E7DDCE"], // cream
  ["#F0E9E4", "#D8C3A9"], // gold
  ["#EAE4EF", "#B79CCB"], // lilac
  ["#F3ECE9", "#DEC79B"], // champagne
];

function tintFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function HairImage({
  src,
  seed,
  alt,
  style,
  monogram = "L",
  monogramSize = 64,
}: {
  /** A remote URL, or a bundled asset from require(). */
  src?: string | number | null;
  seed: string;
  alt: string;
  style?: StyleProp<ViewStyle>;
  monogram?: string;
  monogramSize?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  // A string src is resolved here as well as at the API boundary.
  //
  // Not belt-and-braces for its own sake: plenty of images reach this
  // component WITHOUT passing through the catalogue endpoints — order items
  // snapshot their own image, the wishlist is persisted on the device and can
  // hold a path saved before this fix, and Thumb is handed raw API fields by
  // six different screens. resolveImage is idempotent, so an already-absolute
  // URL passes straight through and this costs nothing.
  //
  // A NUMBER is a bundled require() asset and must never be touched.
  const source = typeof src === "string" ? resolveImage(src) : src;

  /**
   * The URL we have already watched fail.
   *
   * Storing the failed URI rather than a boolean means a NEW `source` clears
   * the state by itself — no effect, no stale "this one is broken" stuck on a
   * product the shopper has since scrolled to.
   *
   * This exists because resolving relative paths changed the failure mode.
   * Before, a relative path became null and this component drew its tonal
   * placeholder without touching the network. Now it becomes a real URL, and
   * if that URL 404s — a file that was never deployed, a product pointing at
   * a photo nobody uploaded — expo-image draws NOTHING and the shopper gets a
   * flat coloured rectangle. That is the grey box mobile/CLAUDE.md forbids.
   */
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (source && source !== failedUri) {
    return (
      <Image
        source={typeof source === "string" ? { uri: source } : source}
        onError={() => {
          if (typeof source === "string") setFailedUri(source);
        }}
        accessible
        accessibilityLabel={alt}
        contentFit="cover"
        // Disk caching matters on a phone data plan: a scrolled catalogue
        // re-fetching every thumbnail is the difference between a fast shop
        // and an expensive one.
        cachePolicy="memory-disk"
        transition={160}
        style={[StyleSheet.absoluteFill, style as never]}
      />
    );
  }

  const [from, to] = tintFor(seed);

  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt}
      style={[styles.placeholder, style]}
    >
      <Text
        style={[
          styles.monogram,
          { fontSize: monogramSize, lineHeight: monogramSize * 1.15 },
        ]}
      >
        {monogram}
      </Text>
    </LinearGradient>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  placeholder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Faint: the monogram is a texture, not a label.
  monogram: { fontFamily: fonts.display, color: "rgba(26,20,32,0.10)" },
});
