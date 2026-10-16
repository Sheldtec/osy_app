# OsyGentle · Hair Co. — Mobile App (Expo starter kit)

React Native app for the OsyGentle hair e-commerce, sharing one Laravel API with the
website. This kit contains the project brief, design tokens and API contract — Claude
Code scaffolds the app around them so it always matches the current Expo SDK.

## Setup (once)

1. Install Node.js LTS if you haven't (you already have it from the web project).
2. Create the app with the latest Expo template, then copy this kit's files into it:
   ```bash
   npx create-expo-app@latest mobile-app
   cd mobile-app
   # copy CLAUDE.md, API-CONTRACT.md, theme/ and lib/ from this kit into the project root
   ```
3. Install **Expo Go** from the App Store (iPhone) and Play Store (Android) — you're
   testing on both.
4. Run it:
   ```bash
   npx expo start
   ```
   Scan the QR code with each phone. You should see the template screen live.

## Develop with Claude Code

```bash
cd luxe-app
claude
```

Claude Code reads `CLAUDE.md` automatically — the design system, soft-morphism surface
rules, all four screen blueprints, Naira formatting and API contract are in there.

### Suggested first prompt
> Read CLAUDE.md and API-CONTRACT.md. Set up fonts (Fraunces + DM Sans via
> @expo-google-fonts), expo-linear-gradient, safe areas, and a cart context persisted
> with AsyncStorage. Build milestone 1 with expo-router: the Home screen exactly per
> the blueprint (greeting header, search pill + purple filter, circular categories,
> Birthday Edit hero, New-in product cards, floating pill bottom nav), then the
> Product detail sheet, Cart, and Checkout — all on mock data from lib/data.ts with
> the api fallback pattern. Use theme/tokens.ts for every color, radius and shadow.
> Run it and fix issues until it renders correctly in Expo Go on iOS and Android.

## Pointing at your Laravel API later
Create `.env` with `EXPO_PUBLIC_API_URL=http://<your-computer-ip>:8000/api`
(use your machine's LAN IP, not localhost, so the phones can reach it).

## What's in this kit
- `CLAUDE.md` — full project brief (design system, screen blueprints, decisions)
- `API-CONTRACT.md` — shared Laravel endpoints (same as the website's)
- `theme/tokens.ts` — palette, radii, soft-shadow, gradients, font names
- `lib/format.ts` — `naira()` formatter · `lib/types.ts` — shared types

---

## What Claude Code scaffolded (milestone 1)

Expo SDK 54 + expo-router + TypeScript, built against the approved soft-morphism
re-skin in Figma — frames `Refined · 1 · Home` (275:2), `Refined · 2 · Product
Detail` (249:102), `Refined · 18 · Cart` (319:2) and `Refined · 3 · Checkout`
(249:163).

```
app/
  _layout.tsx            fonts + cart provider + root stack
  (tabs)/                Home · Shop · Cart · Wallet · Profile
  product/[slug].tsx     media panel + purchase sheet + sticky buy bar
  checkout.tsx           delivery · packaging · payment · pay
components/
  glass-nav.tsx          the floating pill navigation
  product-card.tsx  ui.tsx  hair-image.tsx  icons.ts
lib/
  data.ts  api.ts  cart.tsx     (+ the kit's format.ts / types.ts)
theme/
  tokens.ts  fonts.ts           (kit tokens, extended — see below)
assets/figma/                    55 exported icons + photos
```

**The SDK is pinned to 54 on purpose.** Expo Go supports exactly one SDK at a
time and the owner's device is on the 54 client; moving to 55+ makes the
project unopenable there. The kit's "latest SDK" line predates that constraint.

### Where this departs from the mockup, and why

The frames were drawn against a euro/Ghana dataset in Inter. The locked brief
wins on all four counts, each flagged in code:

| Frame shows | Shipped | Why |
|---|---|---|
| `€129`, `€248.50` | `₦129,000` | Currency is Naira only. Numerals kept so the layout reads at the designed density. |
| Inter throughout | Fraunces + DM Sans | Inter is a placeholder; the type system is locked in CLAUDE.md and matches the website. |
| Mobile Money (MTN · Vodafone) | Bank transfer (Paystack) | Store is Lagos; Paystack is what `POST /orders` actually initialises. |
| Packaging `+€6 / +€18` | `+₦10,000 / +₦30,000` | The amounts the brief specifies. |
| `LUXE15 discount −€15` | omitted | A discount is money. The promo code is captured and carried to checkout for the **server** to validate and price — this client does not invent one. |
| Hard-coded Accra address | editable address form | `POST /orders` requires those fields; posting a placeholder address would be worse than asking. |

Brand purple is `colors.primary` everywhere. The frames drift between `#5C2185`,
`#5C2B7A` and `#5C2A7F` for the same colour; shipping three near-identical
purples would be worse than one.

`theme/tokens.ts` keeps the kit's palette untouched and appends only the
neutrals the re-skin introduces (page grounds, hairlines, glass-nav stops, the
three hero gradients) under `surfaces`, `textInk`, `glassNav` and `heroSlides`.

### Icons

Every glyph is the designer's exported SVG in `assets/figma/`, compiled to a
component by `react-native-svg-transformer` (see `metro.config.js`) and
re-exported from `components/icons.ts`. Do not swap in an icon-font lookalike.

One asset was corrected by hand: Figma exported `radio-off.svg` with
`fill="black"`, which rendered four solid black discs down the checkout. A
re-export will bring the bug back.

### Not built (deliberately)

Wallet and Profile are real tabs with an honest "later milestone" state rather
than mocked balances — CLAUDE.md lists both under *designed, don't build yet*,
and neither has API endpoints. `Refined · 6 · Live Authentication` exists in the
file but must **not** be built: live-video authentication was removed from the
product.

### Checks

```bash
npm run typecheck && npx expo export --platform android
```

The export is the honest one — it proves every import resolves and the bundle
builds, which `tsc` alone does not. To eyeball the screens without a phone,
`mobile-web` is registered in the repo's `.claude/launch.json` and runs the app
in a browser via react-native-web.
