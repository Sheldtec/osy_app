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

/**
 * Whether a human is actually reachable — `GET /support/availability`.
 *
 * Measured, not assumed: the server reports presence from the admin support
 * inbox's own polling, so `online` means "the queue is open on somebody's
 * screen" and nothing stronger. The numbers arrive without prose on purpose
 * (`AgentPresence::snapshot`), because only the client knows which language
 * the shopper is reading in.
 *
 * Every field can be absent or null, and each null means something specific:
 * `last_seen_minutes` null is "the inbox has never been opened", and
 * `typical_reply_minutes` null is "too few answered conversations to quote a
 * time". Neither is a zero, and neither may be rendered as one.
 */
export interface SupportAvailability {
  online: boolean;
  agents: number;
  /** Conversations already in the queue, ahead of this one. */
  waiting: number;
  last_seen_minutes: number | null;
  typical_reply_minutes: number | null;
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

/**
 * The server's cap on the handed-over transcript (`SupportController::store`
 * validates `max:30`). Exported because the handover sheet tells the shopper
 * how many of their messages the agent will be able to read, and a count that
 * disagreed with what was actually sent would be a lie in the one place the
 * screen exists to be honest.
 */
export const MAX_TRANSCRIPT = 30;

interface ConversationPayload {
  id: number;
  ref: string;
  token: string;
  status: SupportStatus;
  agent: string | null;
  messages: SupportMessage[];
}

/**
 * Is anyone there?
 *
 * Asked BEFORE a handover is offered, so a conversation is never queued into
 * an empty room without the shopper being told that is what is happening.
 * Public — a guest has no account to ask with.
 */
export async function fetchSupportAvailability(
  signal?: AbortSignal,
): Promise<SupportAvailability> {
  return request<SupportAvailability>("/support/availability", { signal });
}

export async function startSupport(input: StartSupport): Promise<{
  session: SupportSession;
  status: SupportStatus;
  agent: string | null;
  messages: SupportMessage[];
  /** The server answers with presence as it creates the thread, so the screen
   *  can set the expectation in the same breath as confirming it opened. */
  availability: SupportAvailability | null;
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

  const res = await request<{
    conversation: ConversationPayload;
    availability?: SupportAvailability;
  }>("/support/conversations", {
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
    availability: res.availability ?? null,
  };
}

/**
 * Everything newer than `after`. Pass the highest id you already hold.
 *
 * While the thread is still `waiting` the server attaches presence to every
 * poll, so a queue that quietly emptied out stops looking like a queue being
 * worked. It stops doing that once an agent is in the thread — by then the
 * answer is on screen — so `availability` is optional, not nullable-always.
 */
export async function pollSupport(
  session: SupportSession,
  after: number,
  signal?: AbortSignal,
): Promise<{
  status: SupportStatus;
  ref: string;
  agent: string | null;
  messages: SupportMessage[];
  availability?: SupportAvailability;
}> {
  return request(
    `/support/conversations/${session.id}?token=${encodeURIComponent(session.token)}&after=${after}`,
    { authOptional: true, signal },
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

/**
 * Read the envelope WITHOUT judging or deleting it.
 *
 * Separate from `loadSupportSession` because the guest-handover path has to
 * look at a session it does not own in order to claim it, and the owner check
 * below deletes on a mismatch. Calling the public reader to "peek" would
 * therefore destroy the very conversation it was asked about.
 */
async function readEnvelope(): Promise<Owned<SupportSession> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Owned<SupportSession> | null;

    return parsed?.value?.token ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadSupportSession(
  userId?: number | null,
): Promise<SupportSession | null> {
  const parsed = await readEnvelope();
  if (!parsed) return null;

  if (parsed.owner !== ownerId(userId)) {
    await AsyncStorage.removeItem(KEY).catch(() => {});

    return null;
  }

  return parsed.value;
}

/**
 * A guest signed in: hand their open conversation to the account.
 *
 * This is what the `claim` route is for. Without it the session on disk is
 * still stamped "guest", so the very next owner check DELETES it — the
 * shopper signs in part-way through a support chat and the thread vanishes
 * from the device while the agent is still typing into it on the other side.
 *
 * Returns the session when it now belongs to `userId`, so the caller can show
 * it straight away. Failure is quiet and final: a conversation owned by
 * somebody else is not ours to resume, and leaving a session we cannot
 * authorise on disk only produces a 403 every four seconds.
 */
export async function adoptGuestSupportSession(
  userId: number,
): Promise<SupportSession | null> {
  const parsed = await readEnvelope();
  if (!parsed || parsed.owner !== "guest") return null;

  try {
    await claimSupport(parsed.value);
  } catch {
    await AsyncStorage.removeItem(KEY).catch(() => {});

    return null;
  }

  await saveSupportSession(parsed.value, userId);

  return parsed.value;
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
