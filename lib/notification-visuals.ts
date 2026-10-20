import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

import {
  IconActivityBag,
  IconActivityGift,
  IconActivityPlus,
  IconActivitySale,
  IconAlert,
  IconAnnounce,
  IconBank,
  IconCalendar,
  IconCancelled,
  IconCashOut,
  IconClock,
  IconDocument,
  IconHelp,
  IconNotification,
  IconPeople,
  IconProcessing,
  IconRefund,
  IconShipped,
  IconSparkle,
  IconTag,
  IconThrift,
  IconToPay,
  IconTrash,
  IconVerified,
  IconWalletPay,
  NavProfile,
} from "@/components/icons";
import type { Theme } from "@/theme/theme";

/**
 * How a notification looks, in one place.
 *
 * The feed used to draw every row with the same empty tinted disc, so a
 * referral reward, a shipped order and a price drop were the same object with
 * different sentences in it — which is exactly how a list stops being scanned.
 *
 * TWO LOOKUPS, deliberately, because they answer different questions and have
 * different failure modes:
 *
 *   · The TONE comes from `group`. Groups are a small, closed vocabulary that
 *     the API itself normalises (it falls back to "Account" for any type it
 *     does not recognise), so this is the lookup that is safe to rely on, and
 *     keying it the same way the website does is what stops the two products
 *     disagreeing about what money, or a shipment, or a resale notice looks
 *     like.
 *
 *     It mirrors `components/notification-visuals.ts` on every group BUT ONE:
 *     the web draws Orders in its `info` blue, and this palette has no `info`
 *     token, so Orders are brand purple here. Do not describe this table as a
 *     one-for-one mirror — it was, and the claim outlived the fact. Closing the
 *     gap means adding `info`/`infoBg` to `theme/tokens.ts` and both palettes,
 *     which is a design decision rather than a bug fix.
 *
 *   · The GLYPH comes from `type`, which is a free VARCHAR server-side. That is
 *     fine HERE and nowhere else: this is a lookup with a default, not an
 *     exhaustive switch, so a type added to the catalogue tomorrow renders its
 *     group's glyph in its group's tone instead of a blank well. A type whose
 *     group is also unknown lands on the bell, which is the one glyph that
 *     means nothing in particular.
 *
 * Note the icons are deliberately NOT one-per-group. `wallet.referral` and
 * `wallet.withdrawal_paid` are both money and both green, but one is a friend
 * who bought something and the other is cash reaching a bank account, and the
 * owner's complaint was precisely that those read alike.
 */

/**
 * The visual family a row belongs to.
 *
 * `plan` is instalments and `request` is the two groups where the customer has
 * asked the shop for something and is waiting — a resale listing, a special
 * order. `neutral` is both the Account group and the unknown bucket.
 */
export type NotificationKind =
  | "order"
  | "money"
  | "plan"
  | "offer"
  | "request"
  | "account"
  | "neutral";

export interface NotificationVisual {
  kind: NotificationKind;
  Icon: ComponentType<SvgProps>;
}

/** The well behind the glyph, and the colour of the glyph itself. */
export interface NotificationTone {
  well: string;
  ink: string;
}

/**
 * Group → tone family and the fallback glyph for that family.
 *
 * Keys are the exact strings `NotificationType::catalogue()` emits; "Special
 * orders" really does have a space in it.
 */
const BY_GROUP: Record<string, NotificationVisual> = {
  Orders: { kind: "order", Icon: IconShipped },
  Wallet: { kind: "money", Icon: IconWalletPay },
  Instalments: { kind: "plan", Icon: IconCalendar },
  Marketing: { kind: "offer", Icon: IconActivityGift },
  Thrift: { kind: "request", Icon: IconThrift },
  "Special orders": { kind: "request", Icon: IconDocument },
  // "account", not "neutral": neutral is what an UNKNOWN type falls back to, so
  // sharing it made a welcome or a profile reminder — the first notices a new
  // customer ever sees — look like a row the app could not identify.
  Account: { kind: "account", Icon: IconNotification },
};

const FALLBACK: NotificationVisual = { kind: "neutral", Icon: IconNotification };

/**
 * Type → glyph, refining within the group.
 *
 * Every type in the server's catalogue is here. The groups each keep their own
 * visual logic: Orders walk the fulfilment path (bag → card → carton → van →
 * tick), the two endings share the cancel bar and the return arrow with their
 * equivalents elsewhere, and anything that needs the customer to DO something
 * — an overdue instalment, a plan under review — wears a glyph that says so.
 */
const BY_TYPE: Record<string, ComponentType<SvgProps>> = {
  // ---- Orders --------------------------------------------------------------
  "order.placed": IconActivityBag,
  "order.paid": IconToPay,
  "order.processing": IconProcessing,
  "order.shipped": IconShipped,
  "order.delivered": IconVerified,
  "order.cancelled": IconCancelled,
  "order.refunded": IconRefund,

  // ---- Account -------------------------------------------------------------
  "account.welcome": IconSparkle,
  "account.profile_reminder": NavProfile,

  // ---- Money ---------------------------------------------------------------
  "wallet.credit": IconWalletPay,
  "wallet.debit": IconCashOut,
  "wallet.welcome_credit": IconActivityGift,
  "wallet.referral": IconPeople,
  // Not the wallet: this money has LEFT the wallet and reached a bank.
  "wallet.withdrawal_paid": IconBank,

  // ---- Instalments (layaway) ----------------------------------------------
  // A dated payment reads as a calendar; the day it falls due reads as a clock.
  "installment.due_soon": IconCalendar,
  "installment.due": IconClock,
  "installment.overdue": IconAlert,
  "installment.received": IconActivityPlus,
  "installment.completed": IconVerified,
  // "Under review" is a question about the plan, not a warning about a payment,
  // so it is deliberately not the same triangle as `overdue`.
  "installment.flagged": IconHelp,

  // ---- Special orders ------------------------------------------------------
  "special_order.quoted": IconDocument,
  "special_order.declined": IconCancelled,
  "special_order.refund_owed": IconRefund,

  // ---- Thrift resale -------------------------------------------------------
  "thrift_approved": IconThrift,
  "thrift_rejected": IconCancelled,
  "thrift_removed": IconTrash,

  // ---- Marketing -----------------------------------------------------------
  "marketing.new_arrival": IconActivitySale,
  "marketing.hot_deal": IconTag,
  "marketing.announcement": IconAnnounce,
};

export function visualFor(n: { type: string; group: string }): NotificationVisual {
  const group = BY_GROUP[n.group] ?? FALLBACK;
  const Icon = BY_TYPE[n.type];

  return Icon ? { kind: group.kind, Icon } : group;
}

/**
 * The tone resolved against the active palette.
 *
 * A function of the theme rather than a table of pastels, for the same reason
 * the screen's old `groupTint` was: these are WELLS behind a glyph, so each one
 * has to sit a step away from the card it is on, in whichever direction that
 * card went. Every `ink` here is a token that has been lifted for dark —
 * `primaryOn` rather than `primary`, because this purple is READ as a glyph and
 * brand purple on a dark card is about 1.6:1.
 */
export function toneFor(kind: NotificationKind, t: Theme): NotificationTone {
  switch (kind) {
    case "order":
      return { well: t.colors.primaryCont, ink: t.colors.primaryOn };
    case "money":
      return { well: t.colors.successBg, ink: t.colors.success };
    case "plan":
      // goldDark, not gold2: the glyph is the only thing in the well, so it has
      // to clear the 3:1 floor on its own. gold2 on noteTint is about 2.4:1 —
      // fine behind a chip that also carries a word, invisible as a 1.2px
      // stroke at arm's length, and an overdue instalment is the one notice a
      // customer most needs to recognise at a glance.
      return { well: t.surfaces.noteTint, ink: t.colors.goldDark };
    case "offer":
      return { well: t.surfaces.offerTint, ink: t.colors.goldDark };
    case "request":
      return { well: t.surfaces.verifiedTint, ink: t.colors.primaryOn };
    case "account":
      return { well: t.colors.primaryCont, ink: t.colors.primaryOn };
    case "neutral":
      return { well: t.surfaces.segmentTrack, ink: t.textInk.body };
  }
}
