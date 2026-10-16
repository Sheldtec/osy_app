import { useEffect, useState } from "react";

import { request } from "./http";

/**
 * Store-wide storefront settings — GET /settings/storefront.
 *
 * The app needs these for one reason above all: FEATURE FLAGS. The owner can
 * turn Face-Match and instalments off for the app independently of the
 * website (`feature_facematch_app`, `feature_installments_app`), and a screen
 * that ignores its flag is a screen the owner cannot switch off.
 *
 * The contact block matters too. It is how the concierge hands someone to a
 * real person, and every field in it is OPTIONAL — on a shop that has not
 * filled them in they come back empty, so anything built on them has to
 * disappear rather than offer a button that dials nothing. That is the same
 * rule the server already applies to `address_autofill`: the control can
 * never appear on a shop that cannot answer it.
 */

export interface StorefrontContact {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
}

export interface StorefrontFeatures {
  thrift: boolean;
  preorder: boolean;
  face_match_web: boolean;
  face_match_app: boolean;
  installments: boolean;
  installments_app: boolean;
  address_autofill: boolean;
}

export interface StorefrontSettings {
  store_name: string;
  announcement: { enabled: boolean; text: string };
  address: string | null;
  contact: StorefrontContact;
  features: StorefrontFeatures;
}

/**
 * What the app assumes before it has heard from the server.
 *
 * Everything gated is OFF. A feature that appears and then vanishes once the
 * real flags arrive is worse than one that appears a moment late, and a
 * generative try-on cannot work without the server anyway — so there is
 * nothing to lose by waiting to be told it is on.
 */
const CLOSED: StorefrontFeatures = {
  thrift: false,
  preorder: false,
  face_match_web: false,
  face_match_app: false,
  installments: false,
  installments_app: false,
  address_autofill: false,
};

/** How long a fetched snapshot is reused before we ask again. */
const TTL_MS = 5 * 60_000;

let cached: { at: number; value: StorefrontSettings } | null = null;
let inflight: Promise<StorefrontSettings> | null = null;

export async function getStorefrontSettings(force = false): Promise<StorefrontSettings> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  // One request even when several screens mount at once.
  if (!force && inflight) return inflight;

  inflight = request<StorefrontSettings>("/settings/storefront")
    .then((value) => {
      cached = { at: Date.now(), value };

      return value;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** The last snapshot, if one was ever fetched. Never triggers a request. */
export function peekStorefrontSettings(): StorefrontSettings | null {
  return cached?.value ?? null;
}

export interface SettingsState {
  settings: StorefrontSettings | null;
  /** Gated features, safe to read before the fetch lands (all off). */
  features: StorefrontFeatures;
  loading: boolean;
}

/**
 * Settings for a screen.
 *
 * A stale snapshot is served immediately so the nav does not flicker, and the
 * refresh behind it only ever replaces it with something newer. A FAILED
 * refresh keeps whatever we last knew: one dropped request should not take a
 * feature off the shopper's screen mid-session.
 */
export function useStorefrontSettings(): SettingsState {
  const [settings, setSettings] = useState<StorefrontSettings | null>(peekStorefrontSettings);
  const [loading, setLoading] = useState(settings === null);

  useEffect(() => {
    let alive = true;

    getStorefrontSettings()
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch(() => {
        // Keep the previous snapshot. There is nothing better to show, and
        // blanking it would hide features that are genuinely switched on.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return { settings, features: settings?.features ?? CLOSED, loading };
}

/** The three policies the shop publishes. */
export type LegalSlug = "terms" | "privacy" | "returns";

export interface LegalDoc {
  slug: string;
  title: string;
  /**
   * Sanitised HTML — the server allows only p/h3/ul/ol/li/strong/em/a[href].
   * Render it with `RichText`, never with a WebView.
   */
  body: string;
  /** Which version this is, and since when. */
  revision: number | string | null;
  effective_from: string | null;
}

/**
 * One policy. Public and cached for five minutes upstream, so no auth header —
 * sending one would make the server answer `private, no-store`.
 */
export function getLegal(slug: LegalSlug): Promise<LegalDoc> {
  return request<LegalDoc>(`/legal/${slug}`);
}

