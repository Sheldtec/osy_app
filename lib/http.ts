import { API_BASE, apiHeaders } from "./api";
import { authToken } from "./auth-token";

/**
 * One request, one place that turns a failure into something a screen can act on.
 *
 * `tryFetch` in lib/api.ts cannot be reused for any of this: it is GET-only,
 * unauthenticated, and throws away both the status code and Laravel's `errors`
 * map — all three of which the account and checkout screens need.
 *
 * Nothing here ever invents a result. lib/api.ts serves mock products when no
 * API is configured, which is right for a catalogue and wrong for an order
 * history, a coupon wallet or a membership: an invented one is indistinguishable
 * from a real one and the shopper acts on it.
 */

/** How long any one call may take before we call it unreachable. */
const TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string[]>;
  /** The API's own discriminator. Today only ever "coupon". */
  field?: string;
  /**
   * A STABLE machine-readable cause, for a status that covers several.
   *
   * It exists because of the rule on `fallbackMessage` below: the server's
   * messages are COPY and must never be pattern-matched. A 403 from the support
   * endpoints means either "this conversation is not yours" (permanent) or
   * "your session expired, sign in again" (recoverable), and the client has to
   * tell those apart without reading the sentence — conflating them once
   * destroyed the customer's only copy of their conversation token.
   */
  reason?: string;

  constructor(
    message: string,
    status: number,
    fields?: Record<string, string[]>,
    field?: string,
    reason?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
    this.field = field;
    this.reason = reason;
  }

  fieldError(name: string): string | undefined {
    return this.fields?.[name]?.[0];
  }

  /** The session expired or was never there. The caller must re-authenticate. */
  get unauthenticated(): boolean {
    return this.status === 401;
  }

  /** Nothing reached the server, so nothing was created or changed. */
  get offline(): boolean {
    return this.status === 0;
  }
}

interface ErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
  field?: string;
  reason?: string;
}

export interface RequestInit_ {
  method?: string;
  body?: unknown;
  /** Attach the member bearer token, and fail fast when there is none. */
  auth?: boolean;
  /**
   * Attach the token IF there is one, and carry on without it.
   *
   * For endpoints that answer anyone but answer a signed-in shopper better —
   * the concierge reads your own orders when it can see who you are, and is
   * still useful when it cannot.
   */
  authOptional?: boolean;
  /**
   * Override the timeout for calls that are legitimately slow.
   *
   * The 12s default suits a catalogue read. It is far too short for anything
   * that waits on a third party mid-request: an LLM reply, or a generative
   * image render the server gives 120 seconds of its own. Timing out early
   * there does not just lose the answer — on a write it hides work the server
   * actually completed.
   */
  timeoutMs?: number;
  /**
   * Cancel this request because a newer one has superseded it.
   *
   * Type-ahead is the reason this exists: it fires on a debounce while
   * somebody types, so the only useful thing to do with an in-flight request
   * once the next keystroke lands is stop paying for it — on a phone that is
   * real data and a real radio wake, not just a wasted promise.
   *
   * Cancelling is NOT an error the caller should show. It arrives as an
   * ApiError with status 0, like being offline, so anything that passes a
   * signal has to be willing to swallow the failure.
   */
  signal?: AbortSignal;
}

export async function request<T>(path: string, init: RequestInit_ = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError("The store is not configured on this device.", 0);
  }

  const token = init.auth || init.authOptional ? authToken() : null;
  if (init.auth && !token) {
    throw new ApiError("Please sign in to continue.", 401);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);

  // fetch takes exactly ONE signal, so the timeout and the caller's own
  // cancellation have to be funnelled into the same controller. Forwarding
  // rather than replacing matters: a superseded request still must not be
  // allowed to outlive the timeout.
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (init.signal) {
    if (init.signal.aborted) onAbort();
    else init.signal.addEventListener("abort", onAbort);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: apiHeaders({
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
  } catch {
    // Status 0 is this app's marker for "the request never landed". It matters
    // on a write: nothing was created, so retrying is safe. A caller-cancelled
    // request says so rather than blaming the connection — the one message a
    // screen must never show, because nothing went wrong.
    throw new ApiError(
      cancelled
        ? "The request was cancelled."
        : controller.signal.aborted
          ? "The store took too long to answer. Check your connection and try again."
          : "Could not reach the store. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => ({}))) as ErrorBody & T;

  if (!res.ok) {
    throw new ApiError(
      body.message || fallbackMessage(res.status),
      res.status,
      body.errors,
      body.field,
      body.reason,
    );
  }

  return body as T;
}

/**
 * Copy for the statuses that arrive without a message of their own.
 *
 * Everything else is the server's own wording, which is already written for
 * customers. Never pattern-match those strings: they are copy and will be
 * edited.
 */
function fallbackMessage(status: number): string {
  if (status === 401) return "Please sign in to continue.";
  if (status === 403) return "You don’t have access to that.";
  if (status === 404) return "We couldn’t find that.";
  if (status === 429) return "Too many attempts. Give it a minute and try again.";
  if (status >= 500) return "The store had a problem. Please try again in a moment.";
  return "That didn’t go through. Please try again.";
}
