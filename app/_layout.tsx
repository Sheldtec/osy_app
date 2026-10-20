import { Stack, router, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { Platform, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { CheckoutProvider } from "@/lib/checkout";
import { CurrencyProvider } from "@/lib/currency-context";
import { hasOnboarded } from "@/lib/onboarding";
import { WishlistProvider } from "@/lib/wishlist";
import { useAppFonts } from "@/theme/fonts";
import { ThemeProvider, useTheme, useThemeMode } from "@/theme/theme-context";
import { fonts } from "@/theme/tokens";

// Hold the native splash until Fraunces is ready — otherwise every heading
// flashes in the system serif for a frame.
void SplashScreen.preventAutoHideAsync();

/**
 * Run full-bleed under the Android status bar, and make sure what shows through
 * is the app's canvas rather than a dark strip.
 *
 * Android arrives at that dark strip by two different routes, so both have to
 * be closed:
 *
 *   · Android 14 and below — the status bar is an opaque strip painted in the
 *     host app's theme colour, and the app is laid out beneath it. Asking for a
 *     transparent, translucent bar removes the strip and lets content extend up
 *     into it.
 *
 *   · Android 15 and 16 — the platform forces edge-to-edge, so React Native has
 *     already made the bar transparent and the app already draws behind it.
 *     What shows through there is the WINDOW background, and Expo Go decides
 *     that from the system dark-mode setting (app.json's `userInterfaceStyle`
 *     is compiled into a string resource, so Expo Go's own value wins). On a
 *     phone in dark mode that background is black. Painting the window
 *     explicitly is the only thing that fixes it.
 *
 * React Native ignores the translucency request once edge-to-edge is in force
 * and logs that it did — which is correct, not a failure: on those versions the
 * window paint is doing the work instead.
 *
 * Two libraries that look like they belong here cannot be used:
 * `react-native-edge-to-edge` (which `android.edgeToEdgeEnabled` in app.json
 * relies on) is a native module, and Expo Go ships a fixed set of those; and
 * expo-status-bar dropped `backgroundColor`/`translucent` in SDK 54 on the
 * assumption that edge-to-edge is always on. React Native's own StatusBar still
 * has both, which is why the import comes from there.
 *
 * Translucency is also what produces the full-bleed view: content extends
 * behind the bar, and `useSafeAreaInsets().top` — which every screen already
 * pads by — keeps it out from under the clock.
 *
 * `canvas` is a parameter rather than a token import because the window paint
 * has to follow the theme: on a dark app a light window flashes at the top of
 * every screen whose own background has not painted yet.
 */
function useFullBleedSystemBars(canvas: string): void {
  // Both calls need the activity to exist, so they run in an effect rather than
  // at module scope, where they would silently do nothing.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(canvas);
    if (Platform.OS !== "android") return;
    StatusBar.setTranslucent(true);
    StatusBar.setBackgroundColor("transparent");
  }, [canvas]);
}

/**
 * The theme sits OUTSIDE everything, including the splash gate.
 *
 * It has to: the stored choice is read from AsyncStorage, and the app waits for
 * that read before hiding the splash (see `Root`). A provider mounted inside
 * the gate could not be waited on, and someone who chose dark would get a
 * white flash on every launch.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const theme = useTheme();
  // True once the saved Light/System/Dark choice has been read.
  const { ready: themeReady } = useThemeMode();

  // Imperative, and before the splash hides: the <StatusBar> element below
  // cannot apply anything while this component is still returning null.
  useFullBleedSystemBars(theme.colors.canvas);

  const [loaded, error] = useAppFonts();
  // null = not yet known. The splash stays up until it is, so the welcome
  // screen never flashes over the shop on a returning launch.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  // Navigating before the root navigator has mounted leaves the transition
  // half-applied — a 50%-opacity screen that swallows every touch. Wait for
  // its state to exist before redirecting.
  const navState = useRootNavigationState();

  useEffect(() => {
    hasOnboarded().then(setOnboarded);
  }, []);

  // A font that fails to download must not strand someone on the splash
  // screen; fall through to the system face instead.
  const ready = (loaded || Boolean(error)) && onboarded !== null && themeReady;

  useEffect(() => {
    if (!ready || !navState?.key) return;
    void SplashScreen.hideAsync();
    // Redirect rather than render onboarding as the index, so the tab stack
    // underneath is already mounted when the welcome screen dismisses.
    if (onboarded === false) router.replace("/onboarding");
  }, [navState?.key, onboarded, ready]);

  if (!ready) return null;

  // The root view carries the canvas too, for any gap a screen's own background
  // does not reach.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <SafeAreaProvider>
        <AuthProvider>
          <CurrencyProvider>
            <CartProvider>
              <CheckoutProvider>
                <WishlistProvider>
                  {/* Declarative as well as imperative, because this one is a
                      stack: onboarding pushes light icons for its dark hero
                      panel and this entry is restored when it unmounts. The
                      icons invert with the theme — dark glyphs are invisible
                      on a dark app. */}
                  <StatusBar
                    barStyle={theme.dark ? "light-content" : "dark-content"}
                    backgroundColor="transparent"
                    translucent
                  />
                  <Stack
                    screenOptions={{
                      headerShadowVisible: false,
                      headerStyle: { backgroundColor: theme.colors.surface },
                      headerTitleStyle: {
                        fontFamily: fonts.display,
                        fontSize: 18,
                        color: theme.colors.ink,
                      },
                      headerTintColor: theme.colors.primaryOn,
                      contentStyle: { backgroundColor: theme.colors.canvas },
                    }}
                  >
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    {/* Shown once per install, before anything else. */}
                    <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                    {/* Both of these carry their own in-canvas header from the design,
                        so the navigator must not add a second one. */}
                    <Stack.Screen name="product/[slug]" options={{ headerShown: false }} />
                    {/* Checkout is three steps, each drawing its own in-canvas
                        header, so the navigator must not add one. They are separate
                        routes rather than one scrolling screen because a phone shows
                        one thing at a time: an address form and a payment choice on
                        the same scroll means the shopper cannot see what they are
                        paying while they choose how to pay it. */}
                    <Stack.Screen name="checkout/index" options={{ headerShown: false }} />
                    <Stack.Screen name="checkout/payment" options={{ headerShown: false }} />
                    <Stack.Screen name="checkout/confirm" options={{ headerShown: false }} />
                    {/* Where a hosted gateway page deep-links back to. */}
                    <Stack.Screen name="checkout/return" options={{ headerShown: false }} />
                    {/* The account area. Each screen draws its own in-canvas header,
                        so the navigator must not add a second one. */}
                    <Stack.Screen name="account/orders" options={{ headerShown: false }} />
                    <Stack.Screen name="account/order/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="account/coupons" options={{ headerShown: false }} />
                    <Stack.Screen name="account/wishlist" options={{ headerShown: false }} />
                    <Stack.Screen name="account/hair-profile" options={{ headerShown: false }} />
                    <Stack.Screen name="account/vip" options={{ headerShown: false }} />
                    <Stack.Screen name="account/profile" options={{ headerShown: false }} />
                    <Stack.Screen name="account/password" options={{ headerShown: false }} />
                    <Stack.Screen name="account/wallet-topup" options={{ headerShown: false }} />
                    <Stack.Screen name="account/wallet-withdraw" options={{ headerShown: false }} />
                    <Stack.Screen name="account/special-orders" options={{ headerShown: false }} />
                    <Stack.Screen name="account/preorders" options={{ headerShown: false }} />
                    <Stack.Screen name="account/referrals" options={{ headerShown: false }} />
                    <Stack.Screen name="account/notifications" options={{ headerShown: false }} />
                    <Stack.Screen name="account/currency" options={{ headerShown: false }} />
                    <Stack.Screen name="account/address" options={{ headerShown: false }} />
                    <Stack.Screen name="account/settings" options={{ headerShown: false }} />
                    <Stack.Screen name="account/appearance" options={{ headerShown: false }} />
                    <Stack.Screen name="account/legal/[slug]" options={{ headerShown: false }} />
                    {/* Help and the try-on studio. Both draw their own in-canvas
                        header in the account language, so no navigator header. */}
                    <Stack.Screen name="concierge" options={{ headerShown: false }} />
                    <Stack.Screen name="try-on" options={{ headerShown: false }} />
                    {/* Thrift resale. Both draw their own in-canvas header. */}
                    <Stack.Screen name="thrift/index" options={{ headerShown: false }} />
                    <Stack.Screen name="thrift/[slug]" options={{ headerShown: false }} />
                    {/* Auth is presented as a sheet over whatever asked for it. */}
                    <Stack.Screen
                      name="auth"
                      options={{
                        headerShown: false,
                        presentation: "modal",
                        animation: "slide_from_bottom",
                      }}
                    />
                  </Stack>
                </WishlistProvider>
              </CheckoutProvider>
            </CartProvider>
          </CurrencyProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
