import type { Href } from "expo-router";

import { request } from "./http";

/**
 * Thrift resale — the shop's P2P market, browse half only.
 *
 * `GET /thrift` and `GET /thrift/{slug}` are PUBLIC. No bearer token goes with
 * them on purpose: an authenticated request makes the server answer
 * `private, no-store` and forfeits the upstream cache, which is the same
 * reason `/exchange-rates` is fetched signed-out. The client key still rides
 * on every call and `request()` attaches it.
 *
 * Listing a piece, buyer requests, the escrow order and the buyer↔seller
 * thread all exist on the API and are deliberately NOT here. This pass is
 * browsing; a half-built escrow flow is worse than none, because the shopper
 * cannot tell which half they are in.
 */

export type ThriftStatus = "pending" | "active" | "reserved" | "sold" | "removed";

export interface ThriftCard {
  slug: string;
  /**
   * The unique traceable code the unit shipped with.
   *
   * The point of the whole market: it names ONE physical unit, which is what
   * lets the ownership history travel with the piece. Display it as it
   * arrives — the prefix varies with how old the unit is, and nothing here may
   * reformat or validate it.
   */
  code: string;
  title: string;
  category: string;
  /** The seller's own words from a fixed list — "Like new", "Worn once". */
  condition: string;
  /** How many people have owned this unit. Always at least 1. */
  owners: number;
  /** NAIRA. A catalogue price the shopper READS, so it converts. */
  price: number;
  /** What it cost new, if the seller recorded it. Never below `price`. */
  compare_at: number | null;
  image: string | null;
  seller: string | null;
  seller_avatar: string | null;
  /**
   * The variant the piece was ORIGINALLY bought as, carried over from the
   * seller's own order.
   *
   * Every one of these is absent on listings old enough to predate that
   * record, so nothing may assume a spec exists — `thriftSpec` drops the gaps
   * rather than printing "null · null".
   */
  length?: string | null;
  colour?: string | null;
  density?: string | null;
  preparation?: string | null;
}

/** A sibling listing from the same seller, as the detail endpoint sends it. */
export interface ThriftMiniCard {
  slug: string;
  title: string;
  condition: string;
  price: number;
  compare_at: number | null;
  image: string | null;
}

export interface ThriftDetail extends ThriftCard {
  description: string | null;
  /**
   * Where the piece is in its life.
   *
   * Worth reading rather than assuming "active": the endpoint hides `pending`
   * and `removed` behind a 404, but it will happily serve a `reserved` or
   * `sold` listing — someone following an old link needs to be told so.
   */
  status: ThriftStatus;
  /** The catalogue product it was bought as, when that is known. */
  product_slug: string | null;
  seller_since: string | null;
  created_at: string | null;
  /** Computed seller reputation. Present only on this public endpoint. */
  seller_listings?: number;
  seller_sold?: number;
  more_from_seller?: ThriftMiniCard[];
}

export interface ThriftMeta {
  current_page: number;
  last_page: number;
  total: number;
}

export interface ThriftPage {
  data: ThriftCard[];
  meta: ThriftMeta;
}

/** The server caps `per_page` at 48; this is its own default, stated. */
const PER_PAGE = 24;

/**
 * One page of the market, newest first.
 *
 * Paged rather than "fetch everything once" because the endpoint paginates and
 * a market that outgrows one page would otherwise silently lose its tail.
 */
export async function browseThrift(page = 1): Promise<ThriftPage> {
  const res = await request<Partial<ThriftPage>>(`/thrift?page=${page}&per_page=${PER_PAGE}`);
  const data = res.data ?? [];

  return {
    data,
    // A payload without `meta` is not something the screen should have to
    // guess at: describe it as the single page we actually hold.
    meta: res.meta ?? { current_page: page, last_page: page, total: data.length },
  };
}

/** One listing in full. */
export function getThriftListing(slug: string): Promise<ThriftDetail> {
  return request<ThriftDetail>(`/thrift/${encodeURIComponent(slug)}`);
}

/**
 * The piece's spec as it was bought, with the gaps dropped.
 *
 * Shared by both thrift screens so the two cannot disagree about what a
 * missing variant looks like.
 */
export function thriftSpec(l: Pick<ThriftCard, "length" | "colour" | "density" | "preparation">): string[] {
  return [l.length, l.colour, l.density, l.preparation].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
}

/** "1 owner" / "3 owners" — the figure the resale market is sold on. */
export function ownersLabel(owners: number): string {
  return `${owners} owner${owners === 1 ? "" : "s"}`;
}

/**
 * A listing's route.
 *
 * expo-router builds its route union from the filesystem when Metro runs and
 * writes it to `.expo/types/router.d.ts` (`typedRoutes` is on in app.json), so
 * a route added since the last dev-server start is not in that union yet and
 * `tsc` rejects the literal until the file regenerates. The assertion is
 * confined to this one helper instead of being sprinkled through the screens;
 * once the types have been regenerated it is a no-op and can come out.
 */
export function thriftHref(slug: string): Href {
  const path: string = `/thrift/${encodeURIComponent(slug)}`;

  return path as Href;
}
