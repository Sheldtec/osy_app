/**
 * Where we ship, for the checkout address.
 *
 * The state list is the same 37 the website uses (lib/geo.ts there) and the
 * same spellings, because the server matches shipping zones on this string
 * case-insensitively — "FCT Abuja" resolving to a zone and "Abuja" not is the
 * difference between the real rate and the ₦31,000 fallback.
 *
 * Members ship within Nigeria, exactly as on the website, so there is no
 * country picker here: a foreign address would produce an order nobody can
 * fulfil.
 */
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
