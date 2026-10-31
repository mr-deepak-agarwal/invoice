/**
 * GST helpers — pure functions, no I/O, safe to import from both server
 * and client code (and easy to unit test).
 *
 * The one rule that matters most: whether an invoice carries CGST+SGST
 * (intra-state) or IGST (inter-state) depends on whether the *place of
 * supply* is in the same state as the supplier. Get that wrong and the
 * invoice is wrong, so everything here is explicit about it.
 */

/** GST state / UT codes (the first two digits of every GSTIN). */
export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export const STATE_OPTIONS: { code: string; name: string }[] = Object.entries(
  STATE_NAMES
)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function stateName(code: string | null | undefined): string | null {
  return code ? STATE_NAMES[code] ?? null : null;
}

export function isValidStateCode(code: unknown): code is string {
  return typeof code === "string" && code in STATE_NAMES;
}

// ---------------------------------------------------------------------
// GSTIN
// ---------------------------------------------------------------------

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Checksum character for the first 14 characters of a GSTIN. */
export function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    if (v < 0) return "?";
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Format + state code + checksum. */
export function isValidGstin(raw: string | null | undefined): boolean {
  const g = normalizeGstin(raw);
  if (!GSTIN_FORMAT.test(g)) return false;
  if (!isValidStateCode(g.slice(0, 2))) return false;
  return gstinChecksum(g.slice(0, 14)) === g[14];
}

export function stateCodeFromGstin(raw: string | null | undefined): string | null {
  const g = normalizeGstin(raw);
  return isValidGstin(g) ? g.slice(0, 2) : null;
}

// ---------------------------------------------------------------------
// Finding a state in free text ("panjim goa", "Jaipur", "Tamil Nadu")
// ---------------------------------------------------------------------

/**
 * Best-effort lookup of names and well-known cities. Deliberately
 * conservative: if a message mentions places in two different states we
 * return null rather than guess, because a wrong guess means a wrong tax
 * type. The review step always shows the place of supply before anything
 * is created.
 */
const PLACE_ALIASES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  // Full state / UT names
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    map[normalizeWords(name)] = code;
  }
  const extra: Record<string, string[]> = {
    "01": ["jammu", "srinagar", "kashmir", "jammu and kashmir", "j&k"],
    "02": ["shimla", "manali", "dharamshala"],
    "03": ["amritsar", "ludhiana", "jalandhar", "mohali", "patiala"],
    "04": [],
    "05": ["dehradun", "haridwar", "rishikesh", "haldwani"],
    "06": ["gurgaon", "gurugram", "faridabad", "panipat", "karnal"],
    "07": ["new delhi", "delhi ncr"],
    "08": ["jaipur", "jodhpur", "udaipur", "kota", "ajmer", "bikaner", "alwar", "bhilwara"],
    "09": ["noida", "greater noida", "ghaziabad", "lucknow", "kanpur", "agra", "varanasi", "meerut", "prayagraj", "allahabad"],
    "10": ["patna", "gaya"],
    "18": ["guwahati", "dibrugarh"],
    "19": ["kolkata", "calcutta", "howrah", "siliguri"],
    "20": ["ranchi", "jamshedpur", "dhanbad"],
    "21": ["bhubaneswar", "cuttack", "orissa"],
    "22": ["raipur", "bhilai"],
    "23": ["bhopal", "indore", "gwalior", "jabalpur"],
    "24": ["ahmedabad", "surat", "vadodara", "baroda", "rajkot", "gandhinagar"],
    "26": ["daman", "diu", "silvassa", "dadra"],
    "27": ["mumbai", "bombay", "pune", "nagpur", "thane", "nashik", "navi mumbai", "aurangabad"],
    "29": ["bangalore", "bengaluru", "mysore", "mysuru", "mangalore", "hubli"],
    "30": ["panaji", "panjim", "margao", "madgaon", "mapusa", "vasco", "vasco da gama", "ponda"],
    "32": ["kochi", "cochin", "thiruvananthapuram", "trivandrum", "kozhikode", "calicut", "thrissur"],
    "33": ["chennai", "madras", "coimbatore", "madurai", "salem", "trichy", "tiruchirappalli"],
    "34": ["pondicherry"],
    "36": ["hyderabad", "secunderabad", "warangal"],
    "37": ["vijayawada", "visakhapatnam", "vizag", "guntur", "tirupati", "amaravati"],
    "38": ["leh"],
  };
  for (const [code, names] of Object.entries(extra)) {
    for (const n of names) map[normalizeWords(n)] = code;
  }
  return map;
})();

function normalizeWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Longest names first so "new delhi" wins over "delhi", etc.
const ALIAS_LIST = Object.keys(PLACE_ALIASES).sort((a, b) => b.length - a.length);

/** State code if the text mentions exactly one state; otherwise null. */
export function findStateInText(text: string | null | undefined): string | null {
  if (!text) return null;
  let rest = " " + normalizeWords(text) + " ";
  const found = new Set<string>();
  for (const alias of ALIAS_LIST) {
    const needle = " " + alias + " ";
    if (rest.includes(needle)) {
      found.add(PLACE_ALIASES[alias]);
      // Blank it out so shorter aliases inside it don't also match.
      rest = rest.split(needle).join(" ");
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

// ---------------------------------------------------------------------
// Tax maths
// ---------------------------------------------------------------------

export const DEFAULT_GST_RATE = 18;
export const MAX_GST_RATE = 40;

export type TaxType = "intra" | "inter";

export interface Totals {
  taxType: TaxType;
  taxable: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  total: number;
}

export function taxTypeFor(
  supplierStateCode: string,
  placeOfSupplyCode: string
): TaxType {
  return supplierStateCode === placeOfSupplyCode ? "intra" : "inter";
}

/**
 * All money maths in whole paise (integers) so 0.1 + 0.2 style float
 * errors can't creep into an invoice.
 *
 * Intra-state: the rate is split in two (18% -> 9% CGST + 9% SGST), each
 * half rounded separately, so CGST always equals SGST.
 * Inter-state: the whole rate is IGST.
 */
export function computeTotals(
  taxable: number,
  rate: number = DEFAULT_GST_RATE,
  taxType: TaxType = "intra"
): Totals {
  const taxablePaise = Math.round(taxable * 100);
  const half = rate / 2;

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (taxType === "intra") {
    cgstPaise = Math.round((taxablePaise * half) / 100);
    sgstPaise = cgstPaise;
  } else {
    igstPaise = Math.round((taxablePaise * rate) / 100);
  }

  const totalTaxPaise = cgstPaise + sgstPaise + igstPaise;
  const r = (p: number) => p / 100;

  return {
    taxType,
    taxable: r(taxablePaise),
    cgstRate: taxType === "intra" ? half : 0,
    sgstRate: taxType === "intra" ? half : 0,
    igstRate: taxType === "inter" ? rate : 0,
    cgst: r(cgstPaise),
    sgst: r(sgstPaise),
    igst: r(igstPaise),
    totalTax: r(totalTaxPaise),
    total: r(taxablePaise + totalTaxPaise),
  };
}

export function isValidGstRate(rate: unknown): rate is number {
  return (
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    rate >= 0 &&
    rate <= MAX_GST_RATE
  );
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

/** True for a real calendar date written as YYYY-MM-DD. */
export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no timezone drift). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Indian financial year label for a date, e.g. 2026-10-24 -> "2627". */
export function financialYearLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}${yy(start + 1)}`;
}
