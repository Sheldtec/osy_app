import AsyncStorage from "@react-native-async-storage/async-storage";

import { request } from "./http";
import type { ConciergeTurn } from "./concierge-api";

/**
 * Live human support — the concierge's handoff target.
 *
 * The conversation TOKEN is the credential: it is minted by the server when
 * the chat is created and every later call must carry it. For a guest that is
 * the whole of the authorisation.
 *
 * Once a conversation belongs to an account, `SupportController::assertToken`
 * requires the token AND the account's bearer token — so every call here
 * attaches the bearer when there is one. Polling an account-owned thread
 * without it is a 403, not a fallback to guest access.
 */

export type SupportSender = "customer" | "agent" | "bot" | "system";
export type SupportStatus = "waiting" | "live" | "closed";
export type SupportMsgType = "text" | "image" | "product";

export interface SupportMeta {
  slug?: string;
  name?: string;
  price?: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  spec?: string | null;
  image?: string | null;
  url?: string;
}

export interface SupportMessage {
  id: number;
  sender: SupportSender;
  type: SupportMsgType;
  author: string | null;
  body: string;
  meta?: SupportMeta | null;
  at: string;
}

/** What we must keep to carry on a conversation across launches. */
export interface SupportSession {
  id: number;
  token: string;
  ref: string;
}

export interface StartSupport {
  /** Required for a GUEST, and rejected as empty — the server asks for both. */
  name?: string;
  email?: string;
  subject?: string;
  message: string;
  /** Prior AI turns, oldest first. The server caps this at 30. */
  transcript?: ConciergeTurn[];
}

/** The server's cap on the handed-over transcript. */
const MAX_TRANSCRIPT = 30;

interface ConversationPayload {
  id: number;
  ref: string;
  token: string;
  status: SupportStatus;
  agent: string | null;
  messages: SupportMessage[];
}

export async function startSupport(input: StartSupport): Promise<{
  session: SupportSession;
  status: SupportStatus;
  agent: string | null;
  messages: SupportMessage[];
}> {
  const body: Record<string, unknown> = { message: input.message };
  if (input.name?.trim()) body.name = input.name.trim();
  if (input.email?.trim()) body.email = input.email.trim();
  if (input.subject?.trim()) body.subject = input.subject.trim();
  if (input.transcript?.length) {
    body.transcript = input.transcript.slice(-MAX_TRANSCRIPT).map((t) => ({
      role: t.role,
      content: t.content.slice(0, 2000),
    }));
  }

  const res = await request<{ conversation: ConversationPayload }>("/support/conversations", {
    method: "POST",
    body,
    authOptional: true,
  });

  const c = res.conversation;

  return {
    session: { id: c.id, token: c.token, ref: c.ref },
    status: c.status,
    agent: c.agent,
    messages: c.messages,
  };
}

/** Everything newer than `after`. Pass the highest id you already hold. */
export async function pollSupport(
  session: SupportSession,
  after: number,
): Promise<{ status: SupportStatus; ref: string; agent: string | null; messages: SupportMessage[] }> {
  return request(
    `/support/conversations/${session.id}?token=${encodeURIComponent(session.token)}&after=${after}`,
    { authOptional: true },
  );
}

export async function sendSupport(
  session: SupportSession,
  message: string,
): Promise<SupportMessage> {
  const res = await request<{ message: SupportMessage }>(
    `/support/conversations/${session.id}/messages`,
    {
      method: "POST",
      body: { token: session.token, message },
      authOptional: true,
    },
  );

  return res.message;
}

/** Link a conversation started as a guest to the account that just signed in. */
export async function claimSupport(session: SupportSession): Promise<void> {
  await request(`/support/conversations/${session.id}/claim`, {
    method: "POST",
    body: { token: session.token },
    auth: true,
  });
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

/**
 * Scoped to the account that opened it, like the wishlist and the transcript.
 *
 * This one matters most of the three. The stored token AUTHORISES the
 * conversation, so handing a session left behind by the last person to use the
 * phone to the next one does not just show them an old chat — it lets them
 * post into a stranger's support thread under that stranger's name.
 */
const KEY = "osygentle.support.v1";

interface Owned<T> {
  owner: string;
  value: T;
}

const ownerId = (userId?: number | null) => (userId == null ? "guest" : String(userId));

export async function loadSupportSession(
  userId?: number | null,
): Promise<SupportSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Owned<SupportSession> | null;
    if (parsed?.owner !== ownerId(userId) || !parsed.value?.token) {
      await AsyncStorage.removeItem(KEY).catch(() => {});

      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

export async function saveSupportSession(
  session: SupportSession | null,
  userId?: number | null,
): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(KEY).catch(() => {});

    return;
  }

  const payload: Owned<SupportSession> = { owner: ownerId(userId), value: session };
  await AsyncStorage.setItem(KEY, JSON.stringify(payload)).catch(() => {});
}
