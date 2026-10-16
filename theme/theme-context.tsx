import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { darkTheme, lightTheme, type Theme } from "./theme";

/**
 * Light / dark, and the plumbing that makes a themed StyleSheet possible.
 *
 * Every `StyleSheet.create` in this app was written at MODULE scope, which
 * bakes its colours in at import time — a theme swap cannot reach them. So the
 * conversion is: move the sheet into a factory that takes a theme, and call it
 * through `useThemedStyles` inside the component. The factory stays at module
 * scope (so its identity is stable and the memo actually memoises); only the
 * call moves inside.
 *
 *   const makeStyles = (t: Theme) => StyleSheet.create({ ... })   // module
 *   const styles = useThemedStyles(makeStyles);                   // component
 *
 * Three modes, and LIGHT is the default (owner direction 2026-10-16) — not
 * "system". The shop was designed light: the editorial hero, the gold
 * overlines and the arched product photography were all drawn on pale grounds,
 * and that is what a first-time opener should see. Dark is something you turn
 * on, and "System" is there for the people who want the app to follow their
 * phone, not the assumption that everyone does.
 */

export type ThemeMode = "light" | "dark" | "system";

const MODE_KEY = "osygentle.theme.v1";

interface ThemeValue {
  theme: Theme;
  /** What the customer chose. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** What that resolves to right now — "system" is never the answer here. */
  resolved: "light" | "dark";
  /** False until the stored choice has been read. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Follows the OS live: flipping the phone's setting changes this without a
  // relaunch, which is the whole point of "system".
  const system = useColorScheme();
  // Light, not "system" — see the note above. Someone who has never opened
  // Settings gets the palette the shop was designed in.
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(MODE_KEY);
        if (alive && (saved === "light" || saved === "dark" || saved === "system")) {
          setModeState(saved);
        }
      } catch {
        // Unreadable storage just means light, which is the default anyway.
      } finally {
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(MODE_KEY, next).catch(() => {});
  }, []);

  // `useColorScheme` can return null before the OS has answered — treat that
  // as light rather than flashing a dark app at someone who set neither.
  const resolved: "light" | "dark" =
    mode === "system" ? (system === "dark" ? "dark" : "light") : mode;

  const value = useMemo<ThemeValue>(
    () => ({
      theme: resolved === "dark" ? darkTheme : lightTheme,
      mode,
      setMode,
      resolved,
      ready,
    }),
    [resolved, mode, setMode, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active palette. */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");

  return ctx.theme;
}

/** The chooser, for the Appearance control. */
export function useThemeMode(): Omit<ThemeValue, "theme"> {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used inside <ThemeProvider>");

  const { theme: _theme, ...rest } = ctx;

  return rest;
}

/**
 * A StyleSheet that follows the theme.
 *
 * `factory` MUST be defined at module scope. Declaring it inside the component
 * gives it a new identity on every render, which defeats the memo and rebuilds
 * every sheet on every frame — on a scrolling product grid that is the
 * difference between smooth and not.
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();

  return useMemo(() => factory(theme), [factory, theme]);
}
