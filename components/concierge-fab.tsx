import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconConcierge } from "@/components/icons";
import { easeIn, easeOut, motion, useReducedMotion } from "@/lib/motion";
import { useScrollRevealState } from "@/lib/scroll-reveal";
import { ctaGradient, layout, shadow } from "@/theme/tokens";

import { NAV_CLEARANCE } from "./glass-nav";

/**
 * The concierge launcher — a live-chat bubble, reachable from the browsing tabs.
 *
 * Help used to live at the bottom of the Account tab, behind "Help centre":
 * three taps from the shop floor, which is three too many for the moment
 * somebody has a question about a piece they are looking at.
 *
 * WHERE IT MUST NOT GO, which the website already learned the hard way. Its own
 * widget is pinned bottom-right, and on a narrow screen that corner belongs to
 * whatever the page put there — through checkout, the Pay button itself. The
 * note in `components/concierge-widget.tsx` is blunt about it: "a shopper
 * mid-payment who taps a chat window instead of Pay is a lost sale", and it
 * hides the bubble rather than nudging it, because an offset is a guess about
 * content that will change.
 *
 * Every screen in this app is that narrow screen, so the same rule applies with
 * less room for argument. This renders only on the browsing tabs — the mount
 * point in `app/(tabs)/_layout.tsx` keeps the exclusion list — and never over a
 * sticky purchase bar, a composer, or a payment control.
 *
 * It sits ABOVE the floating nav rather than beside it: `NAV_CLEARANCE` is the
 * room every tab already leaves at the bottom, so clearing it puts the bubble
 * in the one piece of the corner nothing else claims.
 */
export function ConciergeFab() {
  const insets = useSafeAreaInsets();
  const hidden = useScrollRevealState();
  const reduced = useReducedMotion();

  // 1 = shown, 0 = tucked away. One value drives both opacity and the slide so
  // they cannot drift out of step.
  const shown = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const to = hidden ? 0 : 1;

    if (reduced) {
      // The end state is identical; it just arrives at once.
      shown.setValue(to);

      return;
    }

    const animation = Animated.timing(shown, {
      toValue: to,
      duration: motion.fast,
      // Leaving accelerates, arriving decelerates — so it gets out of the way
      // briskly and comes back without a jolt.
      easing: hidden ? easeIn : easeOut,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [hidden, reduced, shown]);

  return (
    // `box-none` so the padded area around the button does not eat taps meant
    // for the content scrolling underneath it. `none` while hidden, because a
    // faded-out button that still swallows taps is worse than no button.
    <Animated.View
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, 12) + NAV_CLEARANCE },
        {
          opacity: shown,
          transform: [
            {
              // Slides down toward the nav as it goes, rather than dissolving
              // in place — it reads as stepping aside instead of vanishing.
              translateY: shown.interpolate({
                inputRange: [0, 1],
                outputRange: [SIZE * 0.55, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents={hidden ? "none" : "box-none"}
    >
      <Pressable
        onPress={() => router.push("/concierge")}
        accessibilityRole="button"
        accessibilityLabel="Ask the concierge"
        accessibilityHint="Opens a chat about pieces, sizing, delivery or an order"
        // The button is 52pt, already past the 44pt floor; the hit slop is for
        // the thumb that lands slightly low, near the nav bar.
        hitSlop={8}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={[...ctaGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fill}
        >
          <IconConcierge width={23} height={23} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const SIZE = 52;

/*
 * A plain module-scope sheet, not a themed factory: nothing here takes a colour
 * from the palette. The fill is the brand gradient, the glyph is white on top
 * of it, and the shadow is the same near-black in either theme — on a dark
 * ground it simply stops being visible, which is the correct behaviour rather
 * than something to compensate for.
 */
const styles = StyleSheet.create({
  wrap: { position: "absolute", right: layout.gutter, alignItems: "flex-end" },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: "hidden",
    // One of the few surfaces a shadow is still for: it floats OVER scrolling
    // content, which is the exception tokens.ts carves out of the flat rule.
    ...shadow({ color: "#1A0F21", opacity: 0.22, radius: 14, offsetY: 6, elevation: 8 }),
  },
  // No scale animation: this sits over moving content and a springing button
  // reads as the page shifting. Opacity says "pressed" without implying that.
  pressed: { opacity: 0.85 },
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
});
