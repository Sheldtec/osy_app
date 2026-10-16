import { request } from "./http";

/**
 * Notifications.
 *
 * The badge and the feed are deliberately separate endpoints, and the split
 * is the whole performance story: `/notifications/unread` is one indexed COUNT
 * that answers in about twelve bytes and is the ONLY thing that may be polled.
 * The feed is cursor-paged on id and is fetched when someone actually opens
 * the screen.
 *
 * All seven routes share a single 60-per-minute bucket with the wallet,
 * orders, coupons, pre-orders and instalments — so an eager badge poll does
 * not just slow itself down, it 429s unrelated account screens. Poll no faster
 * than POLL_MS, and not at all while the app is in the background.
 */

/** The floor for badge polling. Slower is fine; faster is not. */
export const POLL_MS = 30_000;

export interface AppNotification {
  id: number;
  /**
   * A free VARCHAR server-side — new types ship without an app release.
   *
   * Never switch exhaustively on it. Key presentation off `group`, which the
   * API itself falls back to "Account" for anything it does not recognise.
   */
  type: string;
  group: string;
  title: string;
  body: string | null;
  /**
   * A STOREFRONT PATH, not a URL — "/account/orders", "/thrift/some-slug".
   *
   * It must be mapped to an app route, never opened in a browser, and an
   * unmapped path should land somewhere sensible rather than crash.
   */
  link: string | null;
  /**
   * Emitter-specific extras, or null.
   *
   * Null whenever the emitter passed nothing (every thrift notice, every admin
   * broadcast), and the keys differ per emitter — so read defensively.
   */
  data: Record<string, unknown> | null;
  read: boolean;
  at: string | null;
}

export interface NotificationPage {
  /** The badge comes WITH the feed, so opening the screen is one call, not two. */
  unread: number;
  data: AppNotification[];
  /** Pass back as `before` to walk further into history. Null at the end. */
  next_before: number | null;
  has_more: boolean;
}

/**
 * One page of the feed, newest first.
 *
 * `before` walks backwards through history (exclusive). `after` fetches only
 * what has arrived since — but if more than `limit` rows landed you get the
 * newest `limit` and `has_more: true`, which means there is a GAP. Treat that
 * as "reload from the top" rather than stitching.
 */
export function getNotifications(params: {
  limit?: number;
  before?: number;
  after?: number;
} = {}): Promise<NotificationPage> {
  const qs = new URLSearchParams();
  // The server clamps to 1..50 anyway; clamping here keeps the URL honest.
  if (params.limit) qs.set("limit", String(Math.min(Math.max(params.limit, 1), 50)));
  if (params.before) qs.set("before", String(params.before));
  if (params.after) qs.set("after", String(params.after));

  return request<NotificationPage>(
    `/notifications${qs.toString() ? `?${qs}` : ""}`,
    { auth: true },
  );
}

/** Just the badge. The only endpoint meant to be polled. */
export function getUnreadCount(): Promise<{ unread: number }> {
  return request<{ unread: number }>("/notifications/unread", { auth: true });
}

/**
 * Mark one as read, or everything when `id` is omitted.
 *
 * Returns only the recalculated badge — the affected rows do NOT come back, so
 * update local `read` flags optimistically. An id that is not yours, unknown,
 * or already read simply matches nothing: the update is pre-scoped server-side
 * and answers with the unchanged count rather than an error.
 */
export function markRead(id?: number): Promise<{ unread: number }> {
  return request<{ unread: number }>("/notifications/read", {
    method: "POST",
    body: id ? { id } : {},
    auth: true,
  });
}

/**
 * Delete one. HARD — there is no undo endpoint, so confirm before calling.
 *
 * Unlike mark-read this one does 403 on someone else's id, which leaks that it
 * exists; nothing in the app should ever send an id it did not receive.
 */
export function deleteNotification(id: number): Promise<{ unread: number }> {
  return request<{ unread: number }>(`/notifications/${id}`, {
    method: "DELETE",
    auth: true,
  });
}

export interface NotificationPreferences {
  /** The ONE switch a customer owns. */
  marketing_emails: boolean;
  /** Server-owned copy explaining what cannot be turned off. Render it as-is. */
  transactional_note: string;
}

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/notifications/preferences", { auth: true });
}

/**
 * Save the marketing-email switch.
 *
 * `marketing_emails` is REQUIRED — there is no partial PATCH, and omitting it
 * is a 422. Trust the echoed value over the optimistic one.
 */
export function setMarketingEmails(on: boolean): Promise<NotificationPreferences> {
  return request<NotificationPreferences>("/notifications/preferences", {
    method: "PATCH",
    body: { marketing_emails: on },
    auth: true,
  });
}

/**
 * Turn a storefront path into somewhere this app can actually go.
 *
 * The server emits WEB paths. Most have an app equivalent; the ones that do
 * not (thrift, the forum) land on the account home rather than throwing a
 * router error at someone who just tapped a notification.
 */
export function routeForLink(link: string | null): string {
  if (!link) return "/profile";

  const path = link.split("?")[0].replace(/\/+$/, "");

  const MAP: Record<string, string> = {
    "/account": "/profile",
    "/account/orders": "/account/orders",
    "/account/wallet": "/wallet",
    "/account/referrals": "/account/referrals",
    "/account/preorders": "/account/preorders",
    "/account/special-orders": "/account/special-orders",
    "/account/coupons": "/account/coupons",
    "/account/wishlist": "/account/wishlist",
    "/account/vip": "/account/vip",
    "/account/profile": "/account/profile",
    "/account/settings": "/account/profile",
    "/account/preferences": "/account/hair-profile",
    "/account/notifications": "/account/notifications",
    "/cart": "/cart",
    "/shop": "/shop",
  };

  if (MAP[path]) return MAP[path];

  // A product deep-link is the one pattern worth honouring generically.
  const product = /^\/product\/([A-Za-z0-9-]+)$/.exec(path);
  if (product) return `/product/${product[1]}`;

  return "/profile";
}
