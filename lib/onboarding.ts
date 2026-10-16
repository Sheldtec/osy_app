import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Has this install seen the welcome screen?
 *
 * A single flag, not a session: onboarding is about the device, not the
 * account. Signing out must not bring the welcome back, and a second account
 * on the same phone should not have to sit through it again.
 */
const KEY = "osygentle.onboarded";

export async function hasOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    // Storage unavailable — better to skip the welcome than to trap someone
    // on it every launch.
    return true;
  }
}

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, "1");
  } catch {
    /* best effort */
  }
}
