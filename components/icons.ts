/**
 * Every icon on these screens is the designer's exported SVG, compiled to a
 * component by react-native-svg-transformer (see metro.config.js).
 *
 * They are re-exported here under readable names so screens import
 * `IconSearch` rather than a path, and so a re-export from Figma only has to
 * change in one place.
 *
 * Do not substitute a lookalike from an icon font: these are the exact glyphs
 * the design was drawn with, and their outer/leaf geometry is part of the spec.
 */

// Home — header, search, categories
export { default as IconMenu } from "@/assets/figma/icon-menu.svg";
export { default as IconFavorite } from "@/assets/figma/icon-favorite.svg";
export { default as IconBag } from "@/assets/figma/icon-bag.svg";
export { default as IconSearch } from "@/assets/figma/icon-search.svg";
export { default as IconFilter } from "@/assets/figma/icon-filter.svg";
export { default as CatWigs } from "@/assets/figma/cat-wigs.svg";
export { default as CatBundles } from "@/assets/figma/cat-bundles.svg";
export { default as CatClosures } from "@/assets/figma/cat-closures.svg";
export { default as CatFrontals } from "@/assets/figma/cat-frontals.svg";
export { default as CatCurls } from "@/assets/figma/cat-curls.svg";

// Home — hero + product card
export { default as HeroGlow } from "@/assets/figma/hero-glow.svg";
export { default as HeroGold1 } from "@/assets/figma/hero-gold-1.svg";
export { default as HeroGold2 } from "@/assets/figma/hero-gold-2.svg";
export { default as HeroGold3 } from "@/assets/figma/hero-gold-3.svg";
export { default as BadgeDot } from "@/assets/figma/badge-dot.svg";
export { default as IconArrow } from "@/assets/figma/arrow.svg";
export { default as IconHeart } from "@/assets/figma/icon-heart.svg";
export { default as AddCircle } from "@/assets/figma/add-circle.svg";

// Floating navigation
export { default as NavHome } from "@/assets/figma/nav-home.svg";
export { default as NavShop } from "@/assets/figma/nav-shop.svg";
export { default as NavCart } from "@/assets/figma/nav-cart.svg";
export { default as NavCartDot } from "@/assets/figma/nav-cart-dot.svg";
export { default as NavCommunity } from "@/assets/figma/nav-community.svg";
/* Drawn to the house geometry — 20x20, 1.5 stroke, round caps — and in
   `currentColor` so the order meta line can tint them to the body grey
   rather than stamping them in ink. */
export { default as IconCalendar } from "@/assets/figma/icon-calendar.svg";
export { default as IconUnits } from "@/assets/figma/icon-units.svg";
export { default as NavWallet } from "@/assets/figma/nav-wallet.svg";
export { default as NavProfile } from "@/assets/figma/nav-profile.svg";

// Product detail
export { default as PdpArc } from "@/assets/figma/pdp-arc.svg";
export { default as CircleButtonBg } from "@/assets/figma/circle-button.svg";
export { default as IconBack } from "@/assets/figma/icon-back.svg";
export { default as IconHeartOutline } from "@/assets/figma/icon-heart-outline.svg";

// Saved states. A tint alone was invisible — and could not work anyway, because
// the outline hearts hardcode their colour instead of using `currentColor`, so
// the `color` prop passed to them did nothing at all. These are solid, and they
// DO honour `color`.
export { default as IconHeartFilled } from "@/assets/figma/icon-heart-filled.svg";
export { default as IconHeartOutlineFilled } from "@/assets/figma/icon-heart-outline-filled.svg";
export { default as IconVerified } from "@/assets/figma/icon-verified.svg";
export { default as IconBagWhite } from "@/assets/figma/icon-bag-white.svg";

// Cart
export { default as IconRemove } from "@/assets/figma/icon-remove.svg";
export { default as DeliveryIconBg } from "@/assets/figma/delivery-icon-bg.svg";
export { default as IconDelivery } from "@/assets/figma/icon-delivery.svg";
export { default as IconTag } from "@/assets/figma/icon-tag.svg";

// Checkout
export { default as CircleBack } from "@/assets/figma/circle-back.svg";
export { default as IconBackChevron } from "@/assets/figma/icon-back-chevron.svg";
export { default as DeliveryAvatarCircle } from "@/assets/figma/delivery-avatar-circle.svg";
export { default as IconPin } from "@/assets/figma/icon-pin.svg";
export { default as PayCircleActive } from "@/assets/figma/pay-circle-active.svg";
export { default as PayCircle } from "@/assets/figma/pay-circle.svg";
export { default as IconCard } from "@/assets/figma/icon-card.svg";
export { default as IconMomo } from "@/assets/figma/icon-momo.svg";
export { default as IconWalletPay } from "@/assets/figma/icon-wallet-pay.svg";
export { default as IconInstallment } from "@/assets/figma/icon-installment.svg";
export { default as RadioOnOuter } from "@/assets/figma/radio-on-outer.svg";
export { default as RadioOnDot } from "@/assets/figma/radio-on-dot.svg";
// PATCHED: Figma exported this unselected radio with fill="black", which
// rendered four solid black discs down the checkout. The design is a white
// disc inside a #ECE7EC ring, so the fill was corrected by hand — re-export
// this one from Figma and it will come back black.
export { default as RadioOff } from "@/assets/figma/radio-off.svg";
export { default as IconInfo } from "@/assets/figma/icon-info.svg";
export { default as IconGift } from "@/assets/figma/icon-gift.svg";

// Photography exported with the frames — stand-ins until the API sends real
// product photos (the API's `image` field wins whenever it is present).
export const PHOTOS = {
  hero1: require("@/assets/figma/hero-1.png"),
  hero2: require("@/assets/figma/hero-2.png"),
  hero3: require("@/assets/figma/hero-3.png"),
  cart1: require("@/assets/figma/cart-prod-1.png"),
  cart2: require("@/assets/figma/cart-prod-2.png"),
  product: require("@/assets/figma/pdp-hero.png"),
} as const;

/** The gold monogram on the auth screen, and the profile avatar stand-in. */
export const BRAND_LOGO = require("@/assets/figma/auth-logo.png");
export const PROFILE_PHOTO = require("@/assets/figma/profile-photo.png");

/**
 * Which stand-in photo a mock product wears.
 *
 * Presentational only: `Product.image` from the API always wins (see
 * `photoFor`). This exists so the mock catalogue looks like the Figma frames
 * instead of five identical gradients.
 */
const SLUG_PHOTOS: Record<string, number> = {
  "body-wave-bundles": PHOTOS.hero1,
  "lace-closure": PHOTOS.hero2,
  "brazilian-body-wave": PHOTOS.product,
  "kinky-curl-wig": PHOTOS.cart2,
  "hd-frontal-13x4": PHOTOS.hero3,
  "deep-wave-bundles": PHOTOS.cart1,
};

/** The API's photo if it sent one, else the designed stand-in, else null. */
export function photoFor(slug: string, apiImage?: string | null): string | number | null {
  return apiImage ?? SLUG_PHOTOS[slug] ?? null;
}

// Profile — "Refined · 9 · Profile" (249:635)
export { default as IconSettings } from "@/assets/figma/icon-settings.svg";
export { default as IdentityAccent } from "@/assets/figma/identity-accent.svg";
export { default as IconEdit } from "@/assets/figma/icon-edit.svg";
export { default as LoyaltyIconBg } from "@/assets/figma/loyalty-icon-bg.svg";
export { default as IconLoyalty } from "@/assets/figma/icon-loyalty.svg";
export { default as OrderStatusBg } from "@/assets/figma/order-status-bg.svg";
export { default as IconToPay } from "@/assets/figma/icon-to-pay.svg";
export { default as IconProcessing } from "@/assets/figma/icon-processing.svg";
export { default as BadgeCount } from "@/assets/figma/badge-count.svg";
export { default as IconShipped } from "@/assets/figma/icon-shipped.svg";
export { default as IconReview } from "@/assets/figma/icon-review.svg";
export { default as RewardsGlow } from "@/assets/figma/rewards-glow.svg";
export { default as RewardsIconBg } from "@/assets/figma/rewards-icon-bg.svg";
export { default as IconRewards } from "@/assets/figma/icon-rewards.svg";
export { default as AccountIconBg } from "@/assets/figma/account-icon-bg.svg";
export { default as IconAddressBook } from "@/assets/figma/icon-address-book.svg";
export { default as ChevronRight } from "@/assets/figma/chevron-right.svg";
export { default as IconPayment } from "@/assets/figma/icon-payment.svg";
export { default as IconPreferences } from "@/assets/figma/icon-preferences.svg";
export { default as IconHelp } from "@/assets/figma/icon-help.svg";
export { default as IconSignOut } from "@/assets/figma/icon-sign-out.svg";

// Auth — "Refined · 13 · Login" (249:950)
export { default as IconEmail } from "@/assets/figma/icon-email.svg";
export { default as IconLock } from "@/assets/figma/icon-lock.svg";
export { default as IconEye } from "@/assets/figma/icon-eye.svg";
export { default as SocialGoogle } from "@/assets/figma/social-google.svg";
export { default as SocialFacebook } from "@/assets/figma/social-facebook.svg";
export { default as SocialApple } from "@/assets/figma/social-apple.svg";
export { default as IconShield } from "@/assets/figma/icon-shield.svg";

// Home header — the AI try-on entry point. Hand-authored to the set's
// convention (24x24, 1.7 stroke, #1A1420) rather than exported from Figma,
// because the studio was not in the original frames.
export { default as IconTryOn } from "@/assets/figma/icon-try-on.svg";

// Shop — "Refined · 7 · Shop" (249:450)
export { default as ChevronDown } from "@/assets/figma/chevron-down.svg";

// Wallet — "Refined · 4 · Wallet" (249:240)
export { default as IconBell } from "@/assets/figma/icon-bell.svg";
export { default as WalletGlow } from "@/assets/figma/wallet-glow.svg";
export { default as WalletRing } from "@/assets/figma/wallet-ring.svg";
export { default as IconAddMoney } from "@/assets/figma/icon-add-money.svg";
export { default as IconCashOut } from "@/assets/figma/icon-cash-out.svg";
export { default as IconSend } from "@/assets/figma/icon-send.svg";
export { default as ActivityIconBg } from "@/assets/figma/activity-icon-bg.svg";
export { default as IconActivityPlus } from "@/assets/figma/icon-activity-plus.svg";
export { default as IconActivitySale } from "@/assets/figma/icon-activity-sale.svg";
export { default as IconActivityGift } from "@/assets/figma/icon-activity-gift.svg";
export { default as IconActivityBag } from "@/assets/figma/icon-activity-bag.svg";

// Onboarding — "Refined · 8 · Onboarding" (249:602)
export { default as OnboardingEllipse } from "@/assets/figma/onboarding-ellipse.svg";
export { default as OnboardingMedallionA } from "@/assets/figma/onboarding-medallion-a.svg";
export { default as OnboardingMedallionB } from "@/assets/figma/onboarding-medallion-b.svg";
export { default as IconGlobe } from "@/assets/figma/icon-globe.svg";
export const ONBOARDING_HERO = require("@/assets/figma/onboarding-hero.png");
