import type { Product, ProductDetail, Review } from "./types";

/**
 * Mock catalogue.
 *
 * The brief requires every screen to run standalone until Laravel is ready
 * (CLAUDE.md → Stack & architecture), so `lib/api.ts` falls back to these.
 *
 * Prices are NAIRA, not the euros in the Figma mockup — currency is Naira only
 * and that is a product decision, not a styling one. The numerals are kept
 * (€129 → ₦129,000) so the screens read at the designed density.
 */

export const MOCK_PRODUCTS: Product[] = [
  {
    id: 1,
    slug: "body-wave-bundles",
    name: "Body Wave Bundles",
    category: "bundles",
    spec: "100% Remy human hair",
    price: 129000,
    rating: 4.9,
    reviews_count: 212,
    image: null,
    badge: "BEST SELLER",
    code_prefix: "LX",
  },
  {
    id: 2,
    slug: "lace-closure",
    name: "Lace Closure",
    category: "closures",
    spec: "HD transparent lace",
    price: 119000,
    rating: 4.8,
    reviews_count: 168,
    image: null,
    badge: "POPULAR",
    code_prefix: "LX",
  },
  {
    id: 3,
    slug: "brazilian-body-wave",
    name: "Brazilian Body Wave",
    category: "wigs",
    spec: "Grade 12A · Double drawn",
    price: 220000,
    rating: 4.9,
    reviews_count: 212,
    image: null,
    badge: "SALE",
    code_prefix: "LX",
  },
  {
    id: 4,
    slug: "kinky-curl-wig",
    name: "Kinky Curl Wig",
    category: "wigs",
    spec: "Glueless · HD lace",
    price: 149000,
    rating: 4.7,
    reviews_count: 96,
    image: null,
    badge: null,
    code_prefix: "LX",
  },
  {
    id: 5,
    slug: "hd-frontal-13x4",
    name: "HD Frontal 13×4",
    category: "frontals",
    spec: "Pre-plucked hairline",
    price: 185000,
    rating: 4.8,
    reviews_count: 74,
    image: null,
    badge: "NEW",
    code_prefix: "LX",
  },
  {
    id: 6,
    slug: "deep-wave-bundles",
    name: "Deep Wave Bundles",
    category: "bundles",
    spec: "Double drawn · 12A",
    price: 138000,
    rating: 4.6,
    reviews_count: 51,
    image: null,
    badge: null,
    code_prefix: "LX",
  },
];

/**
 * Recent reviews, shared across the mock catalogue. The per-product
 * `reviews_count` is the full tally the API keeps; this list is the page of
 * recent ones the detail endpoint returns alongside it.
 */
const MOCK_REVIEWS: Review[] = [
  {
    author: "Ama M.",
    location: "Accra",
    rating: 5,
    body:
      "Softest hair I have owned. No shedding after three washes and the wave pattern " +
      "comes right back with a little mousse. The traceable code gave me real peace of mind.",
    variant: '16"',
    date: "2026-06-18",
    verified: true,
  },
  {
    author: "Chioma A.",
    location: "Lagos",
    rating: 5,
    body:
      "Delivered in two days to Lekki. Thickness is exactly as described — double drawn, " +
      "full to the ends. Bleached the knots without any trouble.",
    variant: '18"',
    date: "2026-07-02",
    verified: true,
  },
  {
    author: "Tomi O.",
    location: "Abuja",
    rating: 4,
    body:
      "Beautiful lustre and it takes heat well. Only reason for four stars is the 22-inch " +
      "was a touch shorter than I expected after the curl set in.",
    variant: '22"',
    date: "2026-07-21",
    verified: true,
  },
  {
    author: "Ngozi E.",
    location: "Port Harcourt",
    rating: 5,
    body: "Second order. Same quality as the first, which is really all I wanted to know.",
    variant: '14"',
    date: "2026-08-05",
    verified: true,
  },
  {
    author: "Adaeze K.",
    location: "Enugu",
    rating: 4,
    body:
      "Minimal tangling, dyes evenly. Wigging service added three days but the unit came " +
      "back plucked and ready to wear.",
    variant: '20"',
    date: "2026-08-14",
    verified: false,
  },
];

const BASE_DETAIL = {
  description:
    "Raw, unprocessed human hair with a soft natural lustre. Double-drawn so the " +
    "ends stay full, and hand-selected for a consistent pattern from root to tip. " +
    "Every unit ships with its own traceable code.",
  lengths: ['14"', '16"', '18"', '20"', '22"'],
  colours: [
    { name: "Natural", hex: "#1A1420" },
    { name: "#1B", hex: "#241830" },
    { name: "Ombré", hex: "#8A6E42" },
  ],
  densities: ["150%", "180%", "200%"],
  specs: {
    "Hair type": "100% raw virgin human hair",
    Grade: "12A double-drawn",
    Texture: "Body Wave",
    "Lace / cap material": "HD Swiss lace",
    "Cap construction": "Glueless — 4×4 closure",
    Density: "180% (150–200%)",
    Weight: "~280g",
    Lifespan: "2+ years",
    Origin: "Ethically sourced",
  },
  images: [] as string[],
  reviews: MOCK_REVIEWS,
};

export const MOCK_DETAILS: Record<string, ProductDetail> = Object.fromEntries(
  MOCK_PRODUCTS.map((p) => [p.slug, { ...p, ...BASE_DETAIL }]),
);

/** Category rail on Home — the five circles, in the designed order. */
export const CATEGORIES = [
  { key: "wigs", label: "Wigs" },
  { key: "bundles", label: "Bundles" },
  { key: "closures", label: "Closures" },
  { key: "frontals", label: "Frontals" },
  { key: "curls", label: "Curls" },
] as const;
