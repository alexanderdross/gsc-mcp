/**
 * Zod → JSON Schema für das MCP-`inputSchema` ([docs/05]). Deckt bewusst nur den in
 * den Tools verwendeten Zod-Teilbereich ab (Objekt, String, Zahl, Boolean, Enum,
 * Literal, Array, optional/default); Unbekanntes wird zu einem offenen Schema, statt
 * zu raten. Rein und ohne Abhängigkeiten — der MCP-Client braucht JSON Schema, unsere
 * Tools tragen Zod.
 */

import type { z } from "zod";

export type JsonSchema = Record<string, unknown>;

/** Schmaler Blick auf Zods interne Definition — nur die Felder, die wir lesen. */
interface ZodDef {
  readonly typeName: string;
  readonly checks?: ReadonlyArray<{
    readonly kind: string;
    readonly value?: number;
    readonly inclusive?: boolean;
    readonly regex?: RegExp;
  }>;
  readonly innerType?: z.ZodTypeAny;
  readonly type?: z.ZodTypeAny;
  readonly schema?: z.ZodTypeAny;
  readonly values?: readonly string[];
  readonly value?: unknown;
  readonly unknownKeys?: string;
  readonly defaultValue?: () => unknown;
}

function defOf(schema: z.ZodTypeAny): ZodDef {
  return schema._def as unknown as ZodDef;
}

/** Wurzel: Tools erwarten ein Objekt-Schema. Alles andere wird zu einem leeren Objekt. */
export function jsonSchemaFromZod(schema: z.ZodTypeAny): JsonSchema {
  const node = convert(schema);
  if (node.type === "object") return node;
  return { type: "object", properties: {}, additionalProperties: false };
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = defOf(schema);
  switch (def.typeName) {
    case "ZodObject":
      return convertObject(schema);
    case "ZodString":
      return convertString(def);
    case "ZodNumber":
      return convertNumber(def);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...(def.values ?? [])] };
    case "ZodLiteral":
      return literalSchema(def.value);
    case "ZodArray":
      return { type: "array", items: def.type ? convert(def.type) : {} };
    case "ZodOptional":
    case "ZodNullable":
      return def.innerType ? convert(def.innerType) : {};
    case "ZodDefault":
      return {
        ...(def.innerType ? convert(def.innerType) : {}),
        ...(def.defaultValue ? { default: def.defaultValue() } : {}),
      };
    case "ZodEffects":
      return def.schema ? convert(def.schema) : {};
    default:
      return {};
  }
}

function convertObject(schema: z.ZodTypeAny): JsonSchema {
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convert(value);
    if (!isOptional(value)) required.push(key);
  }
  const strict = defOf(schema).unknownKeys === "strict";
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: !strict,
  };
}

/** Optional aus JSON-Schema-Sicht: `.optional()` und `.default()` dürfen fehlen. */
function isOptional(schema: z.ZodTypeAny): boolean {
  const t = defOf(schema).typeName;
  return t === "ZodOptional" || t === "ZodDefault";
}

function convertString(def: ZodDef): JsonSchema {
  const out: JsonSchema = { type: "string" };
  for (const c of def.checks ?? []) {
    if (c.kind === "regex" && c.regex) out.pattern = c.regex.source;
    else if (c.kind === "url") out.format = "uri";
    else if (c.kind === "min" && c.value !== undefined) out.minLength = c.value;
    else if (c.kind === "max" && c.value !== undefined) out.maxLength = c.value;
  }
  return out;
}

function convertNumber(def: ZodDef): JsonSchema {
  const out: JsonSchema = { type: "number" };
  for (const c of def.checks ?? []) {
    if (c.kind === "int") out.type = "integer";
    else if (c.kind === "min" && c.value !== undefined) {
      if (c.inclusive) out.minimum = c.value;
      else out.exclusiveMinimum = c.value;
    } else if (c.kind === "max" && c.value !== undefined) {
      if (c.inclusive) out.maximum = c.value;
      else out.exclusiveMaximum = c.value;
    }
  }
  return out;
}

function literalSchema(value: unknown): JsonSchema {
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return { type: t, const: value };
  }
  return { const: value };
}
