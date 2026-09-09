/**
 * Minimal zod (v3 classic) -> JSON Schema converter covering the types Tau uses for
 * extraction schemas. Unsupported types degrade to `{}` (any), never throw.
 */
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

type ZodDefLike = { typeName?: string; description?: string; [k: string]: unknown };

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def ?? {};
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const out = convert(schema);
  const description = defOf(schema).description;
  if (description && !out.description) out.description = description;
  return out;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(child);
      if (!child.isOptional()) required.push(key);
    }
    const obj: JsonSchema = { type: "object", properties, additionalProperties: false };
    if (required.length) obj.required = required;
    return obj;
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? "integer" : "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodNull) return { type: "null" };
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: [...schema.options] };
  if (schema instanceof z.ZodNativeEnum) return { enum: Object.values(schema.enum as Record<string, unknown>) };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(schema.removeDefault());
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema.unwrap());
    return { anyOf: [inner, { type: "null" }] };
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as z.ZodTypeAny[];
    return { anyOf: options.map((o) => zodToJsonSchema(o)) };
  }
  if (schema instanceof z.ZodRecord) return { type: "object", additionalProperties: zodToJsonSchema(schema.valueSchema) };
  if (schema instanceof z.ZodEffects) return zodToJsonSchema(schema.innerType());
  if (schema instanceof z.ZodDate) return { type: "string", format: "date-time" };
  return {};
}
