import { apiHeaders, API_BASE } from "./api";
import { authToken } from "./auth-token";

/**
 * The community group chat.
 *
 * Reading is public — identity attaches only when a token is sent, which is
 * what lets a signed-out visitor see the room before deciding to join in.
 * Sending needs an account, and the server enforces the room lock and per-member
 * mutes; this client never second-guesses either, it just reports what comes
 * back so the screen can explain it.
 */

export interface CommunityMessage {
  id: number;
  user_id: number | null;
  name: string;
  avatar: string | null;
  /** Posted by the shop rather than a customer. */
  team: boolean;
  mine: boolean;
  type: "text" | "product" | string;
  body: string | null;
  product: Record<string, unknown> | null;
  reply: { id: number; name: string; body: string } | null;
  likes: number;
  liked: boolean;
  at: string | null;
}

export interface CommunityFeed {
  /** The room is paused — only the shop can post. */
  locked: boolean;
  members: number;
  me: { is_admin: boolean; muted: boolean; muted_until: string | null } | null;
  messages: CommunityMessage[];
}

export class CommunityError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) {
    throw new CommunityError(res.status, data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Headers with the bearer token when there is one — reading works without. */
function headers(json = false): Record<string, string> {
  const token = authToken();
  return apiHeaders({
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

export async function fetchCommunityFeed(signal?: AbortSignal): Promise<CommunityFeed | null> {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}/community/messages`, { headers: headers(), signal });
  return parse<CommunityFeed>(res);
}

export async function sendCommunityMessage(
  body: string,
  replyTo?: number | null,
): Promise<CommunityMessage> {
  const res = await fetch(`${API_BASE}/community/messages`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ body, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const data = await parse<{ message?: CommunityMessage } & CommunityMessage>(res);

  return data.message ?? data;
}

export async function likeCommunityMessage(id: number): Promise<{ likes: number; liked: boolean }> {
  const res = await fetch(`${API_BASE}/community/messages/${id}/like`, {
    method: "POST",
    headers: headers(true),
  });
  return parse(res);
}
