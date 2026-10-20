import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { API_BASE } from "./api";
import { request } from "./http";

/**
 * Getting the customer's order receipt out of the app and into their files.
 *
 * The receipt is a printable HTML document rendered by the API from the
 * order's own stored figures. There is no PDF library on the server and no
 * expo-print, expo-sharing or expo-file-system in this app — adding one would
 * mean a native module Expo Go does not bundle, which the owner could not test
 * on their phone. A browser already turns a printable page into a PDF through
 * Print → Save as PDF, so that is the path.
 *
 * Nothing here says "PDF". The button opens a page; the page tells the reader
 * where Print lives. Labelling it a PDF download would be a promise the app
 * does not keep, and the customer only finds out after tapping it.
 */

interface ReceiptLink {
  /**
   * A signed path, relative to the API base exactly like every other path in
   * this app. It is signed rather than token-protected because a browser tab
   * cannot send a bearer token on a plain navigation — see
   * OrderReceiptController. It expires, so it is fetched per tap and never
   * cached.
   */
  path: string;
  expires_at: string;
}

/**
 * Open the receipt for one of the customer's own orders.
 *
 * Throws the usual `ApiError` when the link cannot be minted (signed out,
 * offline, not their order) so the calling screen can say so in its own words.
 *
 * It opens the SYSTEM browser rather than the in-app one. The whole point of
 * the tap is to end up with a saved copy, and Print → Save as PDF is one menu
 * away in Safari and Chrome; inside an Android Custom Tab it is behind "Open
 * in Chrome" first. The in-app browser is kept only as a fallback for a device
 * with no browser registered for http — there the customer can still read it.
 */
export async function openOrderReceipt(orderId: number): Promise<void> {
  const { path } = await request<ReceiptLink>(`/orders/${orderId}/receipt/link`, { auth: true });
  const url = `${API_BASE}${path}`;

  try {
    await Linking.openURL(url);
  } catch {
    await WebBrowser.openBrowserAsync(url);
  }
}
