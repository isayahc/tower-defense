import { z } from "zod";

export const CATALOG_VERSION = "materials-v1";
export const BALANCE_VERSION = "balance-v1";
export const MAX_MASS_G = 1_000_000_000;
export const materialIds = [
  "steel",
  "aluminum",
  "copper",
  "hdpe",
  "glass",
  "rubber",
  "dirt",
  "unknown",
] as const;
export const MaterialIdSchema = z.enum(materialIds);
export type MaterialId = z.infer<typeof MaterialIdSchema>;
export const FormSchema = z.enum([
  "mixed",
  "cable",
  "scrap",
  "stock",
  "wire",
  "flakes",
  "granulate",
  "tread",
]);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const mass = z.number().int().min(1).max(MAX_MASS_G);
const temperature = z.number().finite().min(-273.15).max(5000);
export const ConstituentSchema = z.object({ material: MaterialIdSchema, massG: mass }).strict();
const propertyKinds = [
  "density",
  "electricalConductivity",
  "yieldStrength",
  "maxServiceTemperature",
] as const;
const units = {
  density: "kg/m3",
  electricalConductivity: "S/m",
  yieldStrength: "MPa",
  maxServiceTemperature: "degC",
} as const;
export const PropertySchema = z
  .object({
    kind: z.enum(propertyKinds),
    value: z.number().finite(),
    unit: z.enum(["kg/m3", "S/m", "MPa", "degC"]),
    validFromC: temperature,
    validToC: temperature,
    source: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.unit !== units[value.kind])
      ctx.addIssue({ code: "custom", message: "Property unit mismatch" });
    if (value.validFromC > value.validToC)
      ctx.addIssue({ code: "custom", message: "Invalid property temperature range" });
    if (
      value.kind === "maxServiceTemperature"
        ? value.value < -273.15 || value.value > 5000
        : value.value <= 0
    ) {
      ctx.addIssue({ code: "custom", message: "Property outside its physical domain" });
    }
  });
export const BatchSchema = z
  .object({
    id,
    catalogVersion: z.literal(CATALOG_VERSION),
    massG: mass,
    constituents: z.array(ConstituentSchema).min(1).max(materialIds.length),
    form: FormSchema,
    inspection: z.enum(["uninspected", "identified", "graded"]),
    grade: z.string().min(1).max(100).nullable(),
    condition: z.enum(["sound", "damaged", "unknown"]),
    hazard: z.enum(["none-detected", "suspect-battery", "unknown"]),
    properties: z.array(PropertySchema).max(propertyKinds.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.constituents.reduce((sum, row) => sum + row.massG, 0) !== value.massG)
      ctx.addIssue({ code: "custom", message: "Constituents must equal batch mass" });
    if (new Set(value.constituents.map((row) => row.material)).size !== value.constituents.length)
      ctx.addIssue({ code: "custom", message: "Duplicate constituent" });
    if (new Set(value.properties.map((row) => row.kind)).size !== value.properties.length)
      ctx.addIssue({ code: "custom", message: "Duplicate property" });
    if (value.inspection !== "graded" && (value.grade !== null || value.properties.length))
      ctx.addIssue({ code: "custom", message: "Properties and grade require inspection evidence" });
  });
export type Batch = z.infer<typeof BatchSchema>;
export type Property = z.infer<typeof PropertySchema>;
export type Constituent = z.infer<typeof ConstituentSchema>;

const route = z
  .object({
    material: MaterialIdSchema,
    numerator: z.number().int().min(0).max(1_000_000),
    denominator: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export const RecipeSchema = z
  .object({
    id,
    version: z.literal(BALANCE_VERSION),
    target: MaterialIdSchema,
    inputForms: z.array(FormSchema).min(1),
    minimumPurityBps: z.number().int().min(1).max(10_000),
    machine: id,
    minimumTemperatureC: temperature.nullable(),
    powerW: z.number().int().min(1).max(1_000_000),
    millisecondsPerKg: z.number().int().min(1).max(3_600_000),
    outputs: z
      .array(
        z
          .object({ id, form: FormSchema, routes: z.array(route).min(1).max(materialIds.length) })
          .strict(),
      )
      .min(1)
      .max(8),
    basis: z.literal("game-balance-fixture"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.outputs.map((output) => output.id)).size !== value.outputs.length)
      ctx.addIssue({ code: "custom", message: "Duplicate output stream" });
    for (const material of materialIds) {
      let numerator = 0n;
      let denominator = 1n;
      for (const output of value.outputs) {
        if (new Set(output.routes.map((r) => r.material)).size !== output.routes.length) {
          ctx.addIssue({ code: "custom", message: "Duplicate material route in stream" });
        }
        for (const entry of output.routes.filter((r) => r.material === material)) {
          numerator = numerator * BigInt(entry.denominator) + BigInt(entry.numerator) * denominator;
          denominator *= BigInt(entry.denominator);
        }
      }
      if (numerator > denominator)
        ctx.addIssue({
          code: "custom",
          message: "Routes recover more than the available constituent",
        });
    }
  });
export type Recipe = z.infer<typeof RecipeSchema>;
export const MachineSchema = z
  .object({
    kind: id,
    enabled: z.boolean(),
    availablePowerW: z.number().int().min(0).max(1_000_000),
    availableEnergyJ: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maximumTemperatureC: temperature.nullable(),
  })
  .strict();
export type Machine = z.infer<typeof MachineSchema>;

export const PartSchema = z
  .object({
    id,
    material: MaterialIdSchema,
    form: FormSchema,
    minimumMassG: mass,
    minimumPurityBps: z.number().int().min(1).max(10_000),
    requiresGrade: z.boolean(),
    operatingTemperatureC: temperature,
    properties: z.array(
      z.object({ kind: z.enum(propertyKinds), minimum: z.number().finite() }).strict(),
    ),
    basis: z.literal("game-balance-fixture"),
  })
  .strict();
export type Part = z.infer<typeof PartSchema>;
