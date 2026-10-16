import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing } from "react-native";

/**
 * Motion tokens.
 *
 * One place for durations and curves so transitions across the app feel like
 * one hand rather than several. The scale is deliberately short — this is a
 * shop, and an animation the customer has to wait through is a cost, not a
 * flourish.
 */
export const motion = {
  /** Press feedback, selection ticks. */
  fast: 120,
  /** The default: sheets, fades, most state changes. */
  base: 220,
  /** Full-screen transitions that need to read as a change of place. */
  slow: 300,
} as const;

/** Decelerating — for things arriving. Standard Material/iOS "ease out". */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
/** Accelerating — for things leaving. */
export const easeIn = Easing.bezier(0.4, 0, 1, 1);

/**
 * Whether the OS asks for reduced motion.
 *
 * CLAUDE.md requires respecting it. Callers multiply their duration by 0 when
 * this is true, which keeps every animation's end state intact — the UI still
 * arrives where it should, it just gets there immediately.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setReduced(on))
      .catch(() => {
        /* not supported — assume full motion */
      });

    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
