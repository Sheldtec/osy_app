import { Platform } from "react-native";

/**
 * Which OAuth providers this build can actually sign somebody in with.
 *
 * Google issues a SEPARATE client id per platform — an iOS client, an Android
 * client and a web client are three different audiences for the same shop —
 * and a build is only given the ones it was configured with. So "is Google
 * available" is a question about this platform, not about the app.
 *
 * Nothing here is a secret. An OAuth client id is public by design; it travels
 * in the authorisation URL and is visible to anyone who looks. What makes the
 * flow safe is PKCE and the fact that the SERVER verifies the resulting token's
 * signature and audience before it trusts a single claim in it.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a provider with no client id is not
 * shown. A sign-in button that cannot sign anyone in is worse than no button —
 * the customer spends their trust on it and gets an error back. The address
 * autofill control follows the same rule for the same reason.
 */

const ios = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS?.trim() || undefined;
const android = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID?.trim() || undefined;
const web = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim() || undefined;

/**
 * The ids handed to `Google.useIdTokenAuthRequest`.
 *
 * It picks the right one for the platform itself, which is why all three are
 * passed rather than one chosen here.
 */
export const googleClientIds = { iosClientId: ios, androidClientId: android, webClientId: web };

/**
 * Whether Google sign-in can work on THIS platform right now.
 *
 * Android and iOS each need their own client because Google identifies a native
 * app by its package or bundle id, not by a redirect URL. A build that has only
 * the web client cannot sign in natively, so the button stays hidden rather
 * than failing at the Google consent screen.
 */
export function googleAvailable(): boolean {
  if (Platform.OS === "ios") return Boolean(ios);
  if (Platform.OS === "android") return Boolean(android);

  return Boolean(web);
}

/**
 * Apple and Facebook, deliberately absent.
 *
 * Apple: the API has an endpoint, but `APPLE_CLIENT_ID` is unset on the server,
 * so it answers 503. Turning it on needs a paid Apple Developer account and a
 * Service ID; until then there is nothing to connect to.
 *
 * Facebook: there is no endpoint at all. `routes/api.php` has `/auth/google`
 * and `/auth/apple` and nothing else, and the token verifier only knows how to
 * check Google's and Apple's JWKS.
 *
 * Both buttons are hidden rather than shown-and-broken (owner direction,
 * 2026-10-17). Flip these to true only alongside the server work.
 */
export const appleAvailable = false;
export const facebookAvailable = false;
