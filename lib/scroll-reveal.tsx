import { useFocusEffect } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/**
 * Which way the customer is scrolling, shared between a screen and the chrome
 * floating over it.
 *
 * The concierge bubble is mounted once, in the tab navigator's `tabBar`, so it
 * sits OUTSIDE every screen's list and cannot see a scroll event of its own.
 * Screens report their offset here; the bubble reads the direction. Going the
 * other way — mounting a bubble inside each screen — would mean four copies to
 * keep in step and four chances to get its position wrong.
 *
 * WHY IT HIDES AT ALL: the bubble floats over content, so on a product grid it
 * passes over a card's quick-add button as you scroll. Stepping out of the way
 * while you are moving down the page, and coming back the moment you look for
 * it, is the convention live-chat widgets settled on because it resolves that
 * without giving up the corner.
 */

/** Above this offset the page has barely moved, so the bubble always shows. */
const REST_ZONE = 72;

/**
 * Smaller movements are ignored.
 *
 * A finger resting on a list produces a constant dribble of one- and two-pixel
 * events in both directions. Acting on those makes the bubble strobe.
 */
const JITTER = 6;

interface ScrollRevealActions {
  /** Feed a vertical offset in. Cheap enough to call on every scroll event. */
  report: (y: number) => void;
  /** Back to visible, and forget the last offset. */
  reset: () => void;
}

/**
 * TWO contexts, deliberately, and this is the whole performance story.
 *
 * Every consumer of a context re-renders when that context's VALUE changes
 * identity. Screens call `useScrollReveal` to report scrolling; the bubble
 * calls `useScrollRevealState` to read it. Had both come from one context
 * carrying `hidden`, then every hide and every show would re-render all four
 * tab screens — including the home feed, mid-scroll, which is precisely the
 * jank this feature exists to avoid.
 *
 * So the ACTIONS are their own context whose value never changes identity (both
 * callbacks have empty dependency arrays), and the STATE is a separate context
 * holding a bare boolean. A flip now re-renders the provider and the bubble,
 * and nothing else.
 */
const ActionsContext = createContext<ScrollRevealActions | null>(null);
const HiddenContext = createContext(false);

export function ScrollRevealProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  // A ref, not state: the previous offset is bookkeeping between events and
  // nothing renders from it, so storing it in state would re-render the whole
  // tab tree on every frame of every scroll.
  const lastY = useRef(0);

  const report = useCallback((y: number) => {
    const previous = lastY.current;
    lastY.current = y;

    // Near the top the bubble is always available, whichever way the last
    // flick went — including the rubber-band overscroll above zero, which
    // reports a negative offset and must not read as "scrolling up" forever.
    if (y <= REST_ZONE) {
      setHidden((was) => (was ? false : was));

      return;
    }

    const delta = y - previous;
    if (Math.abs(delta) < JITTER) return;

    const next = delta > 0;
    // Only ever set it to a DIFFERENT value: an unchanged setState still costs
    // a render pass in the consumer, and this runs at 60fps.
    setHidden((was) => (was === next ? was : next));
  }, []);

  const reset = useCallback(() => {
    lastY.current = 0;
    setHidden((was) => (was ? false : was));
  }, []);

  // Stable for the life of the provider: both callbacks close over nothing.
  const actions = useMemo<ScrollRevealActions>(() => ({ report, reset }), [report, reset]);

  return (
    <ActionsContext.Provider value={actions}>
      <HiddenContext.Provider value={hidden}>{children}</HiddenContext.Provider>
    </ActionsContext.Provider>
  );
}

/**
 * Read the direction. For the floating chrome, not for screens.
 *
 * Defaults to `false` with no provider above it, so a surface mounted outside
 * the tab navigator still renders rather than throwing.
 */
export function useScrollRevealState(): boolean {
  return useContext(HiddenContext);
}

/**
 * Report scrolling from a screen.
 *
 * Spread `props` onto a ScrollView or FlatList and that is the whole wiring:
 *
 *   const reveal = useScrollReveal();
 *   <ScrollView {...reveal.props} />
 *
 * A screen that already owns an `onScroll` (the home feed drives its sticky
 * search and its pagination from one) calls `reveal.report(y)` inside the
 * handler it has instead, and ignores `props`.
 *
 * Either way the bubble is restored when the screen gains focus, so changing
 * tabs never lands on a page whose bubble is hidden because of a scroll that
 * happened somewhere else.
 */
export function useScrollReveal(): {
  props: { onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; scrollEventThrottle: number };
  report: (y: number) => void;
} {
  // Only the actions — never `hidden`, or this hook would re-render its screen
  // on every flip. See the note on the two contexts above.
  const ctx = useContext(ActionsContext);
  const report = ctx?.report;
  const reset = ctx?.reset;

  useFocusEffect(
    useCallback(() => {
      reset?.();
    }, [reset]),
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      report?.(e.nativeEvent.contentOffset.y);
    },
    [report],
  );

  const safeReport = useCallback((y: number) => report?.(y), [report]);

  return useMemo(
    () => ({ props: { onScroll, scrollEventThrottle: 16 }, report: safeReport }),
    [onScroll, safeReport],
  );
}
