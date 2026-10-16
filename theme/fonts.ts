import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { Fraunces_300Light, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { useFonts } from "expo-font";

/**
 * Load the brand faces.
 *
 * The keys MUST match `fonts` in ./tokens.ts — that mapping is what every
 * `fontFamily` in the app relies on.
 *
 * Note the deliberate divergence from the Figma file: the mockup was drawn in
 * Inter, but the locked type system (CLAUDE.md, and the website) is Fraunces
 * for display + DM Sans for UI. Inter in the frames is a placeholder, not a
 * decision, so the brand faces win.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    Fraunces_300Light,
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
}
