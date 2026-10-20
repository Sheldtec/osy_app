import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { API_BASE, apiHeaders } from "./api";
import { authToken } from "./auth-token";
import { ApiError, request } from "./http";

/**
 * The signed-in shopper's own profile — `GET /auth/me`, `PATCH /auth/profile`,
 * `PUT /auth/password`, `POST /auth/avatar`.
 *
 * All three are member-only, so every call here is `auth: true`: without a
 * token there is nothing to show and nothing to change, and failing fast is
 * better than rendering an empty form that cannot save.
 */

export interface Profile {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  /** `YYYY-MM-DD`, or null. Drives the birthday-month delivery perk. */
  dob: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** ISO-3166 alpha-2, upper case. */
  country: string | null;
  /** "google" | "apple" | null — how the account was created. */
  provider: string | null;
  /**
   * False for an account created purely through Google or Apple.
   *
   * It decides whether the password screen asks for a CURRENT password: the
   * server requires it only when one is already set, and demanding it from
   * someone who has never had one is an unanswerable question.
   */
  has_password: boolean;
  joined: string | null;
  is_vip: boolean;
  referral_code: string | null;
  profile_complete: boolean;
  profile_todo: { key: string; label: string; href: string }[];
}

export function getProfile(): Promise<Profile> {
  return request<Profile>("/auth/me", { auth: true });
}

/**
 * What the profile form can change.
 *
 * `name` is REQUIRED by the server. The address fields are `sometimes` there,
 * meaning omitting one leaves it alone rather than clearing it — this screen
 * shows all of them, so it sends all of them, and an emptied box genuinely
 * means "remove this".
 */
export interface ProfileUpdate {
  name: string;
  phone?: string | null;
  dob?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

export function updateProfile(input: ProfileUpdate): Promise<Profile> {
  const body: Record<string, unknown> = { name: input.name.trim() };

  // Sent as null rather than "" — the column is nullable and an empty string
  // would read as "has an address, and it is blank".
  const blankToNull = (v?: string | null) => {
    const t = (v ?? "").trim();

    return t === "" ? null : t;
  };

  body.phone = blankToNull(input.phone);
  body.dob = blankToNull(input.dob);

  for (const key of ["address", "city", "state", "zip"] as const) {
    if (input[key] !== undefined) body[key] = blankToNull(input[key]);
  }
  if (input.country !== undefined) {
    const c = blankToNull(input.country);
    body.country = c ? c.toUpperCase() : null;
  }

  return request<Profile>("/auth/profile", { method: "PATCH", body, auth: true });
}

export interface PasswordChange {
  /** Omitted for an account that has never had a password (OAuth-only). */
  currentPassword?: string;
  password: string;
  passwordConfirmation: string;
}

/**
 * Change the password.
 *
 * The server revokes every OTHER token on success, so other devices are signed
 * out — this one keeps working. Worth saying on screen, because a silent
 * sign-out elsewhere looks like a breach to the person it happens to.
 *
 * Note this endpoint does NOT apply `uncompromised()`, unlike registration, so
 * it returns promptly and needs no extended timeout.
 */
export function updatePassword(input: PasswordChange): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/password", {
    method: "PUT",
    body: {
      ...(input.currentPassword ? { current_password: input.currentPassword } : {}),
      password: input.password,
      password_confirmation: input.passwordConfirmation,
    },
    auth: true,
  });
}

// ---------------------------------------------------------------------------
// Settings actions
// ---------------------------------------------------------------------------

/**
 * Sign out every OTHER device, keeping this one.
 *
 * The same thing a password change does as a side effect, offered on its own
 * for the case where nothing is wrong with the password — a shared phone, a
 * borrowed tablet. Returns how many sessions were ended, which is worth
 * showing: "3 signed out" tells you something "done" does not.
 */
export function logoutOtherDevices(): Promise<{ message: string; revoked: number }> {
  return request("/auth/logout-others", { method: "POST", auth: true });
}

/**
 * Re-send the email confirmation.
 *
 * `/auth/me` does NOT carry a verified flag, so the screen cannot state the
 * status up front without borrowing it from the wallet's welcome payload. It
 * asks instead, and the server answers honestly — `verified: true` with "Your
 * email is already confirmed" when there was nothing to send. Throttled at
 * 4/min because it posts mail to an address of the caller's choosing.
 */
export function sendEmailVerification(): Promise<{ message: string; verified: boolean }> {
  return request("/auth/verify/send", { method: "POST", auth: true });
}

/**
 * Close the account. Irreversible from the customer's side.
 *
 * The server demands proof it is really them, and WHICH proof depends on how
 * the account was made: a password for a normal account, the email address
 * typed back for one created through Google or Apple (which has no password to
 * check). `has_password` on the profile is what decides — asking an OAuth-only
 * customer for a password would be an unanswerable question.
 *
 * Every token is revoked server-side, so this device is signed out too.
 */
export function closeAccount(proof: { password?: string; email?: string }): Promise<{ message: string }> {
  return request("/auth/account", {
    method: "DELETE",
    body: proof.password ? { password: proof.password } : { email: proof.email },
    auth: true,
  });
}

// ---------------------------------------------------------------------------
// Profile photo
// ---------------------------------------------------------------------------

/**
 * The server's own limits for an avatar, mirrored.
 *
 * `photo` is the strict CUSTOMER upload tier (`App\Support\Uploads::imageRules`
 * via `AuthController::updateAvatar`): JPEG and PNG only, magic-byte checked
 * server-side, so an iPhone HEIC or a renamed .webp is refused however the
 * picker labelled it — which is why `prepare` below re-encodes before sending
 * rather than trusting the picker's file.
 */
export const AVATAR_MAX_KB = 5120;

/** The longest side we send. An avatar is never drawn larger than ~96pt. */
const AVATAR_EDGE = 1200;

/**
 * Shrink and re-encode a picked photo into something the server will accept.
 *
 * A 12MP camera-roll photo is several times over the 5 MB cap and may be HEIC,
 * which the allow-list does not include — both of which come back as a 422
 * after the upload has already cost the shopper their data. Re-encoding to
 * bounded JPEG on the phone removes both failures before anything is sent.
 *
 * The same problem, solved the same way, as `prepare` in ./special-orders-api —
 * kept local because that one is private to its module and an avatar wants a
 * tighter bound than a reference photo.
 */
async function prepare(photo: { uri: string; width: number; height: number }): Promise<string> {
  const longEdge = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);

  if (longEdge > AVATAR_EDGE) {
    context.resize(photo.width >= photo.height ? { width: AVATAR_EDGE } : { height: AVATAR_EDGE });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });

  return saved.uri;
}

/**
 * Set the profile photo — `POST /auth/avatar`, multipart, field `photo`.
 *
 * `request()` cannot be used: it sets a JSON content type and stringifies the
 * body, and fetch must be left to set its own multipart boundary (which is why
 * no Content-Type is given below). The endpoint answers with the FULL updated
 * profile, so the caller never has to guess the stored URL.
 *
 * Throttled 20/min server-side, and the response waits on Cloudinary, hence
 * the longer timeout than the 12s `request()` default.
 */
export async function uploadAvatar(photo: {
  uri: string;
  width: number;
  height: number;
}): Promise<Profile> {
  const token = authToken();
  if (!API_BASE) throw new ApiError("The store is not configured on this device.", 0);
  if (!token) throw new ApiError("Please sign in to continue.", 401);

  const uri = await prepare(photo);

  const form = new FormData();
  // React Native's FormData takes this {uri, name, type} shape rather than a
  // Blob; the cast is what every RN upload does.
  form.append("photo", { uri, name: "avatar.jpg", type: "image/jpeg" } as unknown as Blob);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/avatar`, {
      method: "POST",
      // No Content-Type: fetch must set the multipart boundary itself.
      headers: apiHeaders({ Authorization: `Bearer ${token}` }),
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? "That upload took too long. Check your connection and try again."
        : "Could not reach the store. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    errors?: Record<string, string[]>;
  } & Profile;

  if (!res.ok) {
    throw new ApiError(body.message || "We couldn’t save that photo.", res.status, body.errors);
  }

  return body as Profile;
}
