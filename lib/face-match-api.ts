import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { request } from "./http";

/**
 * Face-Match studio rendering — POST /face-match/render.
 *
 * The server proxies a generative image model (Gemini or OpenAI, whichever is
 * configured) to put a style onto the customer's own photo. Nothing is stored:
 * the photo goes up with the request and the rendered image comes back in the
 * response body.
 *
 * Three constraints come from `FaceMatchController` and all three shape the
 * screen rather than just this module:
 *
 *  1. The STYLE URL must be `https://res.cloudinary.com/...`. That is an SSRF
 *     guard — the server fetches the style image itself, so the host is
 *     allowlisted. Most of this catalogue's product images are NOT on that
 *     host, so a picker that offers every product would reject most taps.
 *     `canBeStyle` is what keeps those out of the picker in the first place.
 *  2. The photo must be a real JPG or PNG under 6 MB, magic bytes checked.
 *  3. It is member-only and throttled to six calls a minute, because every
 *     call costs the shop money.
 */

/** The only host the server will fetch a style image from. */
export const STYLE_HOST = "res.cloudinary.com";

/**
 * Whether a product photo can be used as a style at all.
 *
 * Checked before the product is ever offered. The alternative — letting
 * someone choose a style, take a photo, and then be told the style "must be a
 * product photo from our catalogue" — blames the shopper for our data.
 */
export function canBeStyle(image?: string | null): boolean {
  if (!image) return false;

  try {
    const u = new URL(image);

    return u.protocol === "https:" && u.hostname.toLowerCase() === STYLE_HOST;
  } catch {
    // Relative paths and placeholders land here. They are not fetchable by
    // the server, so they are not styles.
    return false;
  }
}

/** Longest edge we upload. Bigger costs latency and money for no visible gain. */
export const MAX_EDGE = 1024;

/**
 * Turn a picked photo into the JPEG data URL the endpoint wants.
 *
 * Resizing is done on the LONG edge, which is why the picker's reported
 * dimensions are needed: `resize({width})` alone would enlarge a tall portrait
 * photo rather than shrink it, uploading something bigger than the original.
 *
 * `manipulateAsync` is deprecated in this SDK, so this uses the contextual API.
 */
export async function preparePhoto(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  const longEdge = Math.max(width, height);
  const context = ImageManipulator.manipulate(uri);

  if (longEdge > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.9,
    base64: true,
  });

  if (!saved.base64) {
    throw new Error("Could not read that photo. Please choose another.");
  }

  return `data:image/jpeg;base64,${saved.base64}`;
}

/**
 * A generative render, which the server gives up to 120 seconds of its own.
 *
 * So the client cannot use the 12s default: it would abandon a render that was
 * still coming, and the shop would have paid for it either way.
 */
const RENDER_TIMEOUT_MS = 180_000;

export async function renderLook(
  photoDataUrl: string,
  styleUrl: string,
  styleName: string,
): Promise<string> {
  const res = await request<{ image: string }>("/face-match/render", {
    method: "POST",
    body: {
      photo: photoDataUrl,
      style_url: styleUrl,
      style_name: styleName.slice(0, 120),
    },
    auth: true,
    timeoutMs: RENDER_TIMEOUT_MS,
  });

  return res.image;
}
