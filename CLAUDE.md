# OsyGentle / LUXE — Hair Co. Mobile App (Expo + React Native)

Premium women's hair e-commerce (Lagos, NG): wigs, bundles, frontals, closures — plus
P2P thrift resale, store-credit wallet, referrals and pre-orders in later milestones.
The app shares one Laravel API with the Next.js website (see `API-CONTRACT.md`).

**Figma (source of truth):** app file https://www.figma.com/design/XfTZL6URJIOIXI4tmkEsGV
Original screens on page "App · iPhone 16 Pro Max": Home `30-2`, Product `16-99`,
Checkout `18-2`, Wallet `18-79`. A soft-morphism re-skin of these screens is being
approved in Figma; it changes SURFACES ONLY (see Surface language below), never layouts.

## Stack & architecture
- **Expo (latest SDK) + TypeScript + expo-router** (file-based routing — mirrors the
  Next.js site, so patterns transfer). Scaffold with `npx create-expo-app@latest`.
- Fonts via `@expo-google-fonts/fraunces` and `@expo-google-fonts/dm-sans`.
- State: React context for cart, persisted with `@react-native-async-storage/async-storage`.
- API base URL from `EXPO_PUBLIC_API_URL`. Until Laravel is ready, every screen must run
  on mock data (`lib/data.ts`); the fetch layer in `lib/api.ts` falls back to mocks when
  the env var is unset or a request fails.
- Test target: BOTH iOS and Android via Expo Go — keep everything cross-platform
  (no platform-exclusive components; check shadows on Android via `elevation`).

## Milestone 1 (current): core shopping flow
Home → Product detail → Cart → Checkout. Later (designed, do not build yet):
auth, wallet, thrift resale, referrals, pre-order, community, AI face-match.

## Design system — locked, do not restyle
Tokens live in `theme/tokens.ts` (drop-in file provided). Brand palette is identical
to the website:

| Token | Hex | Use |
|---|---|---|
| primary / primaryDark | #5C2A7F / #3D1A57 | brand purple; CTA gradient #6A3290→#3D1A57 |
| primaryCont | #EEE6F3 | active tints (nav pill, selected states) |
| gold1 / gold2 | #DEC79B / #B7986A | accents, overlines, rings, ratings |
| champ | #C7B39A | warm accents |
| ink / ink2 | #1C1420 / #4A4151 | headings / body |
| muted | #9C94A1 | captions, placeholders |
| canvas | #F3F1F4 | app background (soft neutral) |
| surface | #FFFFFF | cards, pills, sheets |
| imgBg | #EFEAF1 | product-photo backdrops |
| success / danger | #3B7A5E / #C0473E | status |

**Type:** Fraunces (display — greetings, product names, prices, big numbers) +
DM Sans (all UI/body). **Currency: Naira only** — `naira(n)` from `lib/format.ts`
renders `₦220,000` (integer amounts, comma-grouped, no decimals).

### Surface language — "soft morphism" (the approved enhancement)
The ORIGINAL screen layouts are kept exactly; only surfaces changed from the old
flat/hairline style to:
- Soft neutral `canvas` background (no gradients on the page itself).
- White rounded cards, radius 20–24, with a gentle diffuse shadow:
  iOS `shadowColor #221430, shadowOpacity 0.08, shadowRadius 24, offset {0,10}`;
  Android `elevation 4`. Never harsh or dark shadows.
- Controls are pills (search bar r24+, chips r17+, buttons fully rounded).
- **Floating pill bottom navigation**: a white rounded-32 bar inset ~20px from the
  screen edges (not full-width), soft shadow, five tabs — Shop, Thrift, Cart (badge),
  Wallet, Profile — active tab shown as a `primaryCont` pill with primary icon + label.
- Purple gradient reserved for primary CTAs and the hero; gold for accents/rings.

## Screen blueprints (maintain these layouts exactly)
1. **Home** — greeting header: gold letterspaced "GOOD MORNING" over "Hello, {name}"
   in Fraunces 30, gold-ringed avatar right. White search pill + separate purple-gradient
   filter button. Five circular category thumbnails (Wigs · Bundles · Frontals ·
   Closures · Ponytail), selected one wears a thin gold ring, labels beneath. Dark
   purple hero card (gradient primaryDark→primary, gold radial glow + thin gold ring):
   overline "BIRTHDAY EDIT" in gold1, "A gift, just for you" white Fraunces, caption
   "Free delivery + 10% off this month", gold-gradient "Claim offer" pill with
   primaryDark text. "New in" Fraunces + short gold underline + "See all". Two boxed
   white product cards per row: image on `imgBg` (top corners rounded), white heart
   circle, verified code chip (shield + `LX-2291`), name, sub "14" · Grade 12A",
   price in primary Fraunces, star 4.9. Floating pill nav (Shop active).
2. **Product detail** — full-bleed gallery ~54% of screen height with pager dots;
   content sheet slides over it (rounded top 26, drag handle). Verified chip now reads
   "Verified · unique traceable code" (**never** mention authentication video — that
   feature was removed). Name in Fraunces, "Grade 12A · Double drawn · 100% human hair",
   price `₦220,000`, rating 4.9 (212). Wig|Bundle segmented toggle. "CUSTOMISE" section:
   Length chips 14"/16"/18"/22" and Colour chips Natural/#1B/Ombré (selected chip =
   purple gradient, white text). Bottom bar: qty stepper pill "− 1 +" and gradient
   "Add to bag · ₦220,000" (total updates with qty/options).
3. **Cart & Checkout** — back circle + title. DELIVERY card (name, phone, address,
   "Change"). PACKAGING three tier cards (Standard Free / Premium +₦10,000 /
   Luxe gift +₦30,000). PAYMENT METHOD radio rows: Card, Bank transfer (Paystack),
   Wallet credit (balance ₦420,000), Installment; note row "Pay on delivery — Lagos
   only (coming soon)"; Referral/VVIP code row with Apply. Subtotal/Delivery lines,
   bottom bar with Total in Fraunces + gradient "Pay securely" (redirect to Paystack
   `payment_url` from `POST /orders`).
4. **Wallet** (later milestone) — purple balance card with gold ellipse, "STORE CREDIT",
   ₦ balance in Fraunces 44+, card chip + "LUXE · {NAME} · 2291"; Top up / Withdraw /
   Send pills; fee rules card (10% P2P cash-out, 0% top-up); Recent activity rows with
   icon circles and signed ₦ amounts.

## Conventions
- `theme/tokens.ts` and `lib/format.ts` are provided — import, don't duplicate values.
- Product images: real photos when the API provides them; otherwise the tonal-gradient
  placeholder (linear gradient view with a faint white serif monogram) — never grey boxes.
- Respect safe areas (`react-native-safe-area-context`); the floating nav sits above
  the home indicator. Touch targets ≥ 44px. Test every screen on Android too.
