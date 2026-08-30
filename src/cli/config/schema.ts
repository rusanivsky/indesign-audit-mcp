import { z } from "zod";

/**
 * Families — exactly the audit passes (spec §4.3). The list is closed: an
 * unknown name in the config means a typo, not an extension, and silently
 * skipping it would mean silently not checking that family.
 */
export const FAMILY_NAMES = [
  "color",
  "geometry",
  "spelling",
  "typography",
  "styles",
  "pagination",
  "composition",
  "layout",
  "bibliography",
  "sequences",
  "extras",
] as const;

export type FamilyName = (typeof FAMILY_NAMES)[number];

export interface NotApplicable {
  notApplicable: string;
}

/**
 * The reason must be NON-EMPTY: it is printed verbatim in the "What the
 * check didn't see" section. An empty reason would make a skip
 * indistinguishable from an oversight — exactly what that section exists
 * to prevent.
 */
export function isNotApplicable(v: unknown): v is NotApplicable {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.notApplicable === "string" && r.notApplicable.trim().length > 0;
}

const notApplicableSchema = z.object({
  notApplicable: z.string().min(1, "the not-applicable reason cannot be empty"),
});

/**
 * A family is always an OBJECT, never an array: otherwise the "declared not
 * applicable" state would have nowhere to live (spec §5.2). That's why
 * `sequences` carries `rules`.
 */
const familySchema = z.union([notApplicableSchema, z.record(z.string(), z.unknown())]);

export type AuditConfig = {
  edition: { title: string; docPath: string };
  print: { minPpi: number; maxTotalInk: number; expectedInks: number };
  families: Record<FamilyName, unknown>;
};

export const auditConfigSchema: z.ZodType<AuditConfig> = z.object({
  edition: z.object({
    title: z.string().min(1),
    docPath: z.string().min(1),
  }),
  /*
   * There are no off-the-cuff thresholds here by design: minPpi and
   * maxTotalInk are decided by the print shop. The schema only requires
   * that they be NAMED.
   */
  print: z.object({
    minPpi: z.number().positive(),
    maxTotalInk: z.number().positive(),
    expectedInks: z.number().int().positive(),
  }),
  families: z
    .object(
      Object.fromEntries(FAMILY_NAMES.map((f) => [f, familySchema])) as Record<
        FamilyName,
        typeof familySchema
      >,
    )
    .strict(),
});
