/**
 * Where we ship — the country, the region inside it, and what to call them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY NIGERIA IS SPECIAL, AND WHY ITS LIST MUST NOT BE "TIDIED" AWAY
 * ────────────────────────────────────────────────────────────────────────────
 * The server prices delivery in `ShippingFee::quote($country, $state)`, which
 * matches a zone in three passes: country + state, then country alone, then a
 * flat fallback. The first pass compares the state STRING case-insensitively,
 * so the spelling IS the contract — the owner's Nigerian zones are keyed on
 * these 37 names, and a shopper who types "Abuja" instead of "FCT Abuja"
 * misses the zone and is quoted the fallback fee instead of the real rate.
 *
 * That is why Nigeria, and only Nigeria, gets a fixed picker: `usesStateList()`
 * is true for NG alone. Every other country's region is free text, because we
 * cannot curate the world's subdivisions and do not need to — outside Nigeria
 * the owner's zones are country-level, so the region string is carried for the
 * courier's benefit, not the pricer's.
 *
 * The comment that used to sit here said there was no country picker because
 * members ship within Nigeria. That was never true of the server — zones for
 * other countries are already configured (ZA quotes its own country rate
 * today, and everything else falls back cleanly) — and it is no longer true of
 * the app: see `COUNTRIES` below and `components/country-field.tsx`.
 */

/* ------------------------------------------------------------------ *
 * Nigeria — the one curated subdivision list. Do not reword these.
 * ------------------------------------------------------------------ */

export const NG_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT Abuja",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const;

export const STATE_OPTIONS = NG_STATES.map((s) => ({ value: s, label: s }));

/** What an address falls back to when nothing says otherwise: the shop is in Lagos. */
export const DEFAULT_COUNTRY = "NG";

/* ------------------------------------------------------------------ *
 * Countries
 * ------------------------------------------------------------------ */

export interface Country {
  /** ISO 3166-1 alpha-2, upper case. This is what the API stores. */
  code: string;
  /** The name shown to a shopper, in the English form they would search for. */
  name: string;
}

/**
 * ISO 3166-1 alpha-2 — the sovereign states plus the territories that take
 * their own post. Typed in roughly alphabetical order and sorted properly
 * below, so adding one does not mean finding its slot by hand.
 */
const RAW: readonly (readonly [string, string])[] = [
  ["AF", "Afghanistan"],
  ["AX", "Åland Islands"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AS", "American Samoa"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AI", "Anguilla"],
  ["AG", "Antigua and Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AW", "Aruba"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BM", "Bermuda"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia and Herzegovina"],
  ["BW", "Botswana"],
  ["BR", "Brazil"],
  ["VG", "British Virgin Islands"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["CV", "Cabo Verde"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["KY", "Cayman Islands"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["KM", "Comoros"],
  ["CG", "Congo — Brazzaville"],
  ["CD", "Congo — Kinshasa"],
  ["CK", "Cook Islands"],
  ["CR", "Costa Rica"],
  ["CI", "Côte d’Ivoire"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CW", "Curaçao"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"],
  ["EE", "Estonia"],
  ["SZ", "Eswatini"],
  ["ET", "Ethiopia"],
  ["FK", "Falkland Islands"],
  ["FO", "Faroe Islands"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GF", "French Guiana"],
  ["PF", "French Polynesia"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GI", "Gibraltar"],
  ["GR", "Greece"],
  ["GL", "Greenland"],
  ["GD", "Grenada"],
  ["GP", "Guadeloupe"],
  ["GU", "Guam"],
  ["GT", "Guatemala"],
  ["GG", "Guernsey"],
  ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HN", "Honduras"],
  ["HK", "Hong Kong SAR China"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IR", "Iran"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IM", "Isle of Man"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JE", "Jersey"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LR", "Liberia"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MO", "Macao SAR China"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MH", "Marshall Islands"],
  ["MQ", "Martinique"],
  ["MR", "Mauritania"],
  ["MU", "Mauritius"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MC", "Monaco"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MS", "Montserrat"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NC", "New Caledonia"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["NU", "Niue"],
  ["KP", "North Korea"],
  ["MK", "North Macedonia"],
  ["MP", "Northern Mariana Islands"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PW", "Palau"],
  ["PS", "Palestinian Territories"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["PR", "Puerto Rico"],
  ["QA", "Qatar"],
  ["RE", "Réunion"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["BL", "Saint Barthélemy"],
  ["SH", "Saint Helena"],
  ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"],
  ["MF", "Saint Martin"],
  ["PM", "Saint Pierre and Miquelon"],
  ["VC", "Saint Vincent and the Grenadines"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["ST", "São Tomé and Príncipe"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SX", "Sint Maarten"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["SS", "South Sudan"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["SD", "Sudan"],
  ["SR", "Suriname"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["SY", "Syria"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TK", "Tokelau"],
  ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"],
  ["TR", "Türkiye"],
  ["TM", "Turkmenistan"],
  ["TC", "Turks and Caicos Islands"],
  ["TV", "Tuvalu"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["VI", "U.S. Virgin Islands"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VA", "Vatican City"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["YE", "Yemen"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
];

/**
 * The other names people actually type.
 *
 * Someone looking for the Emirates types "UAE", and for Britain "UK" — neither
 * string appears in the official name, so without this the search looks broken
 * on two of our likeliest diaspora markets. Matched folded (lower case,
 * accents off) and only ever as an input to the ranking: an alias is never
 * displayed, so the list still reads as one consistent set of names.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  AE: ["uae", "emirates", "dubai", "abu dhabi"],
  GB: ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
  US: ["usa", "america", "united states of america"],
  NL: ["holland"],
  CI: ["ivory coast"],
  CV: ["cape verde"],
  CZ: ["czech republic"],
  SZ: ["swaziland"],
  MM: ["burma"],
  KR: ["korea", "south korea", "republic of korea"],
  KP: ["north korea"],
  TR: ["turkey", "turkiye"],
  CD: ["drc", "democratic republic of the congo", "zaire"],
  CG: ["republic of the congo"],
  MK: ["macedonia"],
  TL: ["east timor"],
  RU: ["russian federation"],
  VN: ["viet nam"],
  SY: ["syrian arab republic"],
  TZ: ["zanzibar"],
  HK: ["hong kong"],
  MO: ["macau", "macao"],
  VA: ["holy see", "rome"],
  PS: ["palestine"],
  LA: ["lao"],
};

/* ------------------------------------------------------------------ *
 * Folding — so "cote" finds Côte d’Ivoire
 * ------------------------------------------------------------------ */

/**
 * The accents, taken off.
 *
 * A replacement table rather than `String.normalize("NFD")`: Hermes ships
 * without the Unicode data that call needs, and whether "sao tome" finds its
 * row must not depend on which JS engine built the app.
 */
const DIACRITICS: Readonly<Record<string, string>> = {
  "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "ā": "a",
  "ç": "c", "č": "c",
  "è": "e", "é": "e", "ê": "e", "ë": "e", "ē": "e",
  "ì": "i", "í": "i", "î": "i", "ï": "i", "ī": "i",
  "ñ": "n",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ō": "o", "ø": "o",
  "š": "s",
  "ù": "u", "ú": "u", "û": "u", "ü": "u", "ū": "u",
  "ý": "y", "ÿ": "y",
  "ž": "z",
  "æ": "ae", "œ": "oe", "ß": "ss",
};

/** Lower case, accents off, punctuation turned into spaces. */
function fold(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) out += DIACRITICS[ch] ?? ch;

  // Nobody types a curly apostrophe into a search box, and "cote d ivoire"
  // should land on the same row as "cote divoire".
  return out.replace(/[’'`´—–\-.,()]/g, " ").replace(/\s+/g, " ").trim();
}

/** Alphabetical by the folded name, so "Åland" sorts with the A's. */
export const COUNTRIES: readonly Country[] = RAW.map(([code, name]) => ({ code, name })).sort(
  (a, b) => {
    const x = fold(a.name);
    const y = fold(b.name);

    return x < y ? -1 : x > y ? 1 : 0;
  },
);

/** Code → display name. */
const NAME_BY_CODE: Record<string, string> = {};
for (const c of COUNTRIES) NAME_BY_CODE[c.code] = c.name;

/** Pre-folded haystacks, built once — this list is re-filtered on every keypress. */
const HAYSTACK: readonly { country: Country; name: string; words: string[]; aliases: string[] }[] =
  COUNTRIES.map((country) => {
    const name = fold(country.name);

    return {
      country,
      name,
      words: name.split(" "),
      aliases: (ALIASES[country.code] ?? []).map(fold),
    };
  });

/** The `{ value, label }` shape `SelectField` takes, for a plain dropdown. */
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

/**
 * Whatever an account or a draft holds, as a usable alpha-2 code.
 *
 * Blank, whitespace and lower case all resolve; an UNRECOGNISED two-letter
 * code is kept rather than rewritten, because silently moving a customer's
 * country to Nigeria during an unrelated edit is how an order ends up on the
 * wrong continent. Use `isKnownCountry()` when you need to know which it is.
 */
export function normalizeCountry(input?: string | null): string {
  const code = (input ?? "").trim().toUpperCase();

  return code.length === 2 ? code : DEFAULT_COUNTRY;
}

export function isKnownCountry(code?: string | null): boolean {
  return Boolean(NAME_BY_CODE[normalizeCountry(code)]);
}

/** The display name, or the code itself when we do not know it. */
export function countryName(code?: string | null): string {
  const c = normalizeCountry(code);

  return NAME_BY_CODE[c] ?? c;
}

export function findCountry(code?: string | null): Country | undefined {
  const c = normalizeCountry(code);
  const name = NAME_BY_CODE[c];

  return name ? { code: c, name } : undefined;
}

/* ------------------------------------------------------------------ *
 * What the parts of an address are called
 * ------------------------------------------------------------------ */

export type RegionLabel = "State" | "Province" | "Region" | "County";

const REGION_STATE = [
  "AU", "BR", "FM", "IN", "MH", "MM", "MX", "NG", "PW", "SS", "US", "VE",
];

const REGION_PROVINCE = [
  "AO", "AR", "BE", "CA", "CD", "CG", "CN", "CR", "CU", "DO", "EC", "ES", "ID",
  "IR", "IT", "KR", "MZ", "NL", "PA", "PH", "PK", "TH", "TR", "TW", "VN", "ZA",
  "ZM", "ZW",
];

const REGION_COUNTY = ["EE", "GB", "HU", "IE", "KE", "LR", "NO", "RO", "SE"];

/**
 * "State", "Province", "Region" or "County" — whichever the country's own post
 * calls it.
 *
 * Region is the default because it is the one word that is never badly wrong:
 * a shopper in France reading "Region" writes Île-de-France, whereas "State"
 * on a French form reads as a question about nationality.
 */
export function regionLabel(code?: string | null): RegionLabel {
  const c = normalizeCountry(code);
  if (REGION_STATE.includes(c)) return "State";
  if (REGION_PROVINCE.includes(c)) return "Province";
  if (REGION_COUNTY.includes(c)) return "County";

  return "Region";
}

export type PostcodeLabel = "ZIP code" | "Postcode" | "Postal code";

/** Says ZIP: America, its territories, and the Philippines. */
const POSTCODE_ZIP = ["AS", "GU", "MP", "PH", "PR", "US", "VI"];

/**
 * Says Postcode — one word, no "al".
 *
 * Ireland is here AND in `NO_POSTCODE` below, which is not a contradiction: an
 * Eircode is colloquially a postcode, so that is what to call the box — it is
 * just not a box we insist on.
 */
const POSTCODE_UK = [
  "AU", "BD", "GB", "GG", "IE", "IM", "IN", "JE", "LK", "MY", "NG", "NZ", "PK",
  "SG", "ZA",
];

export function postcodeLabel(code?: string | null): PostcodeLabel {
  const c = normalizeCountry(code);
  if (POSTCODE_ZIP.includes(c)) return "ZIP code";
  if (POSTCODE_UK.includes(c)) return "Postcode";

  return "Postal code";
}

/**
 * The countries with no postal code system at all.
 *
 * Hong Kong, the Emirates, Ghana, Tanzania, Panama, Jamaica (which abolished
 * its codes in 2007) and the rest genuinely have nothing to type, so demanding
 * one is a wall with no door. The server does not want it either: order
 * creation leaves `zip` unvalidated and nullable.
 *
 * Substantially the UPU's "no postal code" list. Ireland is here despite
 * Eircode — Eircode exists, but most Irish addresses are still written without
 * one, and requiring it would block real deliveries to a real market.
 */
const NO_POSTCODE = [
  "AE", "AG", "AI", "AO", "AW", "BF", "BI", "BJ", "BS", "BW", "BZ", "CD", "CF",
  "CG", "CI", "CK", "CM", "CW", "DJ", "DM", "ER", "FJ", "GA", "GD", "GH", "GM",
  "GN", "GQ", "GY", "HK", "IE", "JM", "KI", "KM", "KN", "LC", "LY", "ML", "MO",
  "MR", "MS", "MW", "NR", "NU", "PA", "QA", "RW", "SB", "SC", "SL", "SO", "SR",
  "ST", "SX", "SY", "TD", "TG", "TK", "TL", "TO", "TT", "TV", "TZ", "UG", "VU",
  "YE", "ZW",
];

/**
 * Whether to insist on a postcode for this country.
 *
 * An unknown code answers true: most of the world has postcodes, and asking
 * for one we did not need is only a question, while skipping one the courier
 * needed is a failed delivery.
 */
export function postcodeRequired(code?: string | null): boolean {
  return !NO_POSTCODE.includes(normalizeCountry(code));
}

/**
 * Countries that DO issue a code but where we must not insist on one.
 *
 * Ireland is the case this exists for, and the reasoning is already written
 * above `POSTCODE_UK`: an Eircode is real and worth capturing, but most Irish
 * addresses are still written without one. So the box is shown and labelled,
 * and left optional. Without this list `hasPostcode` was a plain alias of
 * `postcodeRequired`, which meant an Irish shopper had nowhere at all to put a
 * code they actually had — and the Irish branch of `postcodeLabel()` was dead.
 */
const OPTIONAL_POSTCODE = ["IE"];

/**
 * Whether to SHOW a postcode box at all — a different question from whether to
 * demand one, which is `postcodeRequired()`.
 *
 * Every screen that renders the field should ask this one; every guard that
 * blocks a save or a payment should ask the other.
 */
export function hasPostcode(code?: string | null): boolean {
  const c = normalizeCountry(code);

  return OPTIONAL_POSTCODE.includes(c) || postcodeRequired(c);
}

/**
 * Whether the region is PICKED from a curated list rather than typed.
 *
 * True for Nigeria only, and the reason is money, not tidiness — see the top
 * of this file. If a second country's zones are ever keyed on sub-national
 * names, its list belongs here and nowhere else.
 */
export function usesStateList(code?: string | null): boolean {
  return normalizeCountry(code) === "NG";
}

/** The curated options for a country, or none when the region is free text. */
export function regionOptions(code?: string | null): { value: string; label: string }[] {
  return usesStateList(code) ? STATE_OPTIONS : [];
}

/**
 * City-states and microstates: countries with no sub-national division to name.
 *
 * Demanding a region here makes the shopper invent one — typically retyping the
 * city — to get past a form, and that invented string is then posted as
 * `delivery.state`. The server never wanted it: order creation validates
 * `state` as nullable.
 */
const NO_REGION = ["SG", "MC", "VA", "QA", "BH", "LU", "MT", "HK", "MO", "GI", "AD", "LI", "SM", "NR", "TV"];

/**
 * The longest region string the whole system will accept.
 *
 * The two endpoints disagree: `GET /api/shipping/quote` validates `state` as
 * `max:60` while `POST /orders` and `PATCH /auth/profile` allow `max:120`. A
 * region between 61 and 120 characters therefore saves and orders perfectly
 * while every quote 422s for ever — the delivery row shows "—", the Pay total
 * silently omits delivery, and the server charges the real fee anyway. 60 is the
 * stricter bound and so the only safe one.
 *
 * A `maxLength` on the input is NOT enough. It bounds typing; it does not touch
 * a value that arrives from the server, and these columns are also written by
 * the website, where the same box accepted 120. So anything loaded or sent has
 * to pass through `clampRegion()`.
 */
export const REGION_MAX = 60;

export function clampRegion(value?: string | null): string {
  return (value ?? "").trim().slice(0, REGION_MAX);
}

/**
 * Whether an address in this country must name a region.
 *
 * True almost everywhere, because for a courier the subdivision is part of the
 * address — a US or Canadian parcel without one is undeliverable, and in Nigeria
 * it is what the delivery is PRICED on. False only where there is nothing to
 * name.
 */
export function regionRequired(code?: string | null): boolean {
  return !NO_REGION.includes(normalizeCountry(code));
}

/**
 * Which keyboard the postcode field should open.
 *
 * Not cosmetic. Those fields currently hard-code `number-pad`, which is right
 * for Nigeria's six digits and a dead end for "SW1A 1AA" or "M5V 2T6" — there
 * is no way to type a letter on that keyboard. So the asymmetry is deliberate:
 * a known all-digits country gets the number pad, and everything else —
 * including every country not classified here — gets the full keyboard,
 * because a full keyboard can still type digits.
 */
const NUMERIC_POSTCODE = [
  "AT", "AU", "BD", "BE", "BG", "BR", "CH", "CL", "CN", "CO", "CR", "CY", "CZ",
  "DE", "DK", "DZ", "EC", "EG", "ES", "ET", "FI", "FR", "GR", "GT", "HR", "HU",
  "ID", "IL", "IN", "IQ", "IS", "IT", "JP", "KE", "KH", "KR", "KW", "LK", "LU",
  "MA", "MK", "MN", "MX", "MY", "NG", "NO", "NP", "NZ", "PE", "PH", "PL", "PT",
  "PY", "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "SN", "SV", "TH", "TN",
  "TR", "TW", "UA", "US", "UY", "VE", "VN", "ZA",
];

/**
 * Digits PLUS a separator — "01310-100", "00-001", "1234-567", "150-0001".
 *
 * These were classified numeric, which is almost right and fails on the one
 * character that matters: the iOS number pad has no hyphen key, so a Warsaw
 * shopper could only enter "00001". They get the numeric keyboard that also
 * carries punctuation.
 */
const PUNCTUATED_POSTCODE = ["BR", "JP", "PL", "PT", "NL", "CZ", "SK", "SE", "PY"];

export function postcodeKeyboard(
  code?: string | null,
): "number-pad" | "numbers-and-punctuation" | "default" {
  const c = normalizeCountry(code);
  if (PUNCTUATED_POSTCODE.includes(c)) return "numbers-and-punctuation";

  return NUMERIC_POSTCODE.includes(c) ? "number-pad" : "default";
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * The country list, filtered and ranked for a typed query.
 *
 * Ranking matters more than it sounds. On a plain `includes` filter, typing
 * "ni" puts Benin, Bosnia and Herzegovina and Guinea above Nigeria, which
 * reads as the search ignoring you. The order is:
 *
 *   0  the exact alpha-2 code      "ng" → Nigeria
 *   1  an exact alias              "uk" → United Kingdom, not Ukraine
 *   2  the name starts with it     "nig" → Niger, Nigeria
 *   3  a word in the name does     "korea" → the Koreas
 *   4  an alias starts with it     "emir" → United Arab Emirates
 *   5  it appears anywhere         "ine" → Ukraine, Palestinian Territories
 *
 * Rank 1 exists because of rank 2: "uk" is the whole point of the alias and
 * Ukraine's name genuinely starts with it, so without an exact-alias tier the
 * United Kingdom loses its own search term. Ties keep the alphabetical order,
 * because `Array.sort` is stable and the input is already sorted.
 *
 * An empty query returns the whole list.
 */
export function searchCountries(query: string, limit?: number): Country[] {
  const q = fold(query);
  if (!q) return limit ? COUNTRIES.slice(0, limit) : [...COUNTRIES];

  const scored: { country: Country; rank: number }[] = [];
  for (const row of HAYSTACK) {
    const rank =
      row.country.code.toLowerCase() === q
        ? 0
        : row.aliases.includes(q)
          ? 1
          : row.name.startsWith(q)
            ? 2
            : row.words.some((w) => w.startsWith(q))
              ? 3
              : row.aliases.some((a) => a.startsWith(q))
                ? 4
                : row.name.includes(q) || row.aliases.some((a) => a.includes(q))
                  ? 5
                  : -1;
    if (rank >= 0) scored.push({ country: row.country, rank });
  }

  scored.sort((a, b) => a.rank - b.rank);
  const out = scored.map((s) => s.country);

  return limit ? out.slice(0, limit) : out;
}
