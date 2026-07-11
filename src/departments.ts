/**
 * Pick n Pay Lydenburg department master.
 * Codes are SAP merchandise-hierarchy nodes of the form "Z1/<dept>".
 */
export const DEPARTMENTS: Record<string, string> = {
  "Z1/F53": "Convenience",
  "Z1/F55": "Outsourced Bakery",
  "Z1/G12": "Edible Groceries",
  "Z1/G13": "Non-Edible",
  "Z1/G14": "Liquor",
  "Z1/G15": "Toiletries",
  "Z1/G99": "Bottle Returns",
  "Z1/M83": "Outdoor",
  "Z1/M85": "Office",
  "Z1/M88": "Home",
  "Z1/P11": "Perishable Groceries",
};

// secondary lookup by the suffix only (e.g. "F53" -> "Z1/F53")
const BY_SUFFIX: Record<string, string> = Object.fromEntries(
  Object.keys(DEPARTMENTS).map((code) => [code.split("/").pop()!.toUpperCase(), code]),
);

/** Canonicalize a raw department code to the "Z1/XYZ" form, if recognized. */
export function canonicalDeptCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (DEPARTMENTS[s]) return s;
  // accept "Z1-F53", "Z1 F53", or bare "F53"
  const suffix = s.includes("/") ? s.split("/").pop()! : s.replace(/^Z1[-_]?/, "");
  if (BY_SUFFIX[suffix]) return BY_SUFFIX[suffix];
  return undefined;
}

/** Resolve a department name from a (possibly messy) code, with fallback. */
export function resolveDeptName(rawCode: string | undefined, providedName?: string): string | undefined {
  const canonical = canonicalDeptCode(rawCode);
  if (canonical) return DEPARTMENTS[canonical];
  return providedName?.trim() || undefined;
}
