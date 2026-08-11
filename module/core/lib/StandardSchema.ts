// deno-lint-ignore-file no-explicit-any
/**
 * Minimal Standard-Schema-compatible validator for api.
 * Browser-compatible, zero dependencies.
 * Spec: https://standardschema.dev
 */

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly value?: undefined; readonly issues: readonly StandardIssue[] };

export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}

// ───── Schema type ────────────────────────────────────────────────────────

type Kind = "string" | "number" | "boolean" | "object" | "array" | "optional" | "record" | "any";
type Validator<T> = (value: unknown, path: PropertyKey[]) => StandardResult<T>;

declare const OPTIONAL_BRAND: unique symbol;
type Optional<T> = StandardSchema<T | undefined> & { readonly [OPTIONAL_BRAND]: true };

export class StandardSchema<T = unknown> {
  readonly "~standard": { readonly version: 1; readonly vendor: "api"; readonly validate: (value: unknown) => StandardResult<T> };
  readonly kind: Kind;
  readonly shape?: Record<string, StandardSchema<any>>;
  readonly inner?: StandardSchema<any>;
  readonly defaultValue?: () => T;
  readonly description?: string;

  constructor(kind: Kind, validator: Validator<T>, extras: { shape?: Record<string, StandardSchema<any>>; inner?: StandardSchema<any>; defaultValue?: () => T; description?: string } = {}) {
    this.kind = kind;
    this.shape = extras.shape;
    this.inner = extras.inner;
    this.defaultValue = extras.defaultValue;
    this.description = extras.description;
    const def = extras.defaultValue;
    this["~standard"] = {
      version: 1,
      vendor: "api",
      validate: (value) => value === undefined && def ? { value: def() } : validator(value, []),
    };
  }

  default(value: T): StandardSchema<T> {
    return new StandardSchema<T>(this.kind, (v) => this["~standard"].validate(v), {
      shape: this.shape,
      inner: this.inner,
      defaultValue: () => value,
      description: this.description,
    });
  }

  describe(description: string): StandardSchema<T> {
    return new StandardSchema<T>(this.kind, (v) => this["~standard"].validate(v), {
      shape: this.shape,
      inner: this.inner,
      defaultValue: this.defaultValue,
      description,
    });
  }
}

// ───── Helpers ────────────────────────────────────────────────────────────

function err(path: PropertyKey[], message: string): StandardIssue[] {
  return [{ message, path }];
}

// ───── Builder `s` ────────────────────────────────────────────────────────

export const s = {
  string: (): StandardSchema<string> => new StandardSchema<string>("string", (v, p) =>
    typeof v === "string" ? { value: v } : { issues: err(p, "expected string") }),

  number: (): StandardSchema<number> => new StandardSchema<number>("number", (v, p) =>
    typeof v === "number" && Number.isFinite(v) ? { value: v } : { issues: err(p, "expected number") }),

  boolean: (): StandardSchema<boolean> => new StandardSchema<boolean>("boolean", (v, p) =>
    typeof v === "boolean" ? { value: v } : { issues: err(p, "expected boolean") }),

  object: <Shape extends Record<string, StandardSchema<any>>>(shape: Shape): StandardSchema<InferObject<Shape>> => {
    const keys = Object.keys(shape);
    return new StandardSchema<InferObject<Shape>>("object", (v, p) => {
      if (v == null || typeof v !== "object" || Array.isArray(v)) return { issues: err(p, "expected object") };
      const out: Record<string, unknown> = {};
      const issues = [];
      for (const key of keys) {
        const res = shape[key]["~standard"].validate((v as Record<string, unknown>)[key]);
        if (res.issues) issues.push(...res.issues.map((iss) => ({ message: iss.message, path: [key, ...(iss.path ?? [])] })));
        else if (res.value !== undefined) out[key] = res.value;
      }
      return issues.length ? { issues } : { value: out as InferObject<Shape> };
    }, { shape });
  },

  array: <T>(item: StandardSchema<T>): StandardSchema<T[]> =>
    new StandardSchema<T[]>("array", (v, p) => {
      if (!Array.isArray(v)) return { issues: err(p, "expected array") };
      const out = [];
      const issues = [];
      for (let i = 0; i < v.length; i++) {
        const res = item["~standard"].validate(v[i]);
        if (res.issues) issues.push(...res.issues.map((iss) => ({ message: iss.message, path: [i, ...(iss.path ?? [])] })));
        else out.push(res.value);
      }
      return issues.length ? { issues } : { value: out };
    }, { inner: item }),

  // null counts as "not set" here, so JSON inputs pass
  // todo: check which apis rely on that, then move to strict (v === undefined) plus an s.nullable()
  optional: <T>(inner: StandardSchema<T>) =>
    new StandardSchema<T | undefined>("optional", (v) =>
      v == null ? { value: undefined } : inner["~standard"].validate(v) as StandardResult<T | undefined>,
    { inner }) as Optional<T>,

  any: (): StandardSchema<unknown> =>
    new StandardSchema<unknown>("any", (v) => ({ value: v })),

  record: <T = unknown>(value?: StandardSchema<T>): StandardSchema<Record<string, T>> =>
    new StandardSchema<Record<string, T>>("record", (v, p) => {
      if (v == null || typeof v !== "object" || Array.isArray(v)) return { issues: err(p, "expected object") };
      if (!value) return { value: v as Record<string, T> };
      const out: Record<string, T> = {};
      const issues = [];
      for (const [k, val] of Object.entries(v)) {
        const res = value["~standard"].validate(val);
        if (res.issues) issues.push(...res.issues.map((iss) => ({ message: iss.message, path: [k, ...(iss.path ?? [])] })));
        else out[k] = res.value;
      }
      return issues.length ? { issues } : { value: out };
    }, value ? { inner: value } : {}),
};

// ───── Type inference ─────────────────────────────────────────────────────

type OptionalKeys<Shape> = { [K in keyof Shape]: Shape[K] extends Optional<any> ? K : never }[keyof Shape];
type RequiredKeys<Shape> = Exclude<keyof Shape, OptionalKeys<Shape>>;
type Infer<S> = S extends StandardSchema<infer T> ? T : never;

export type InferObject<Shape extends Record<string, StandardSchema<any>>> =
  & { [K in RequiredKeys<Shape>]: Infer<Shape[K]> }
  & { [K in OptionalKeys<Shape>]?: Infer<Shape[K]> };

export function toJsonSchema(schema: StandardSchema): Record<string, unknown> {
  const desc = schema.description ? { description: schema.description } : {};
  switch (schema.kind) {
    case "string":   return { type: "string", ...desc };
    case "number":   return { type: "number", ...desc };
    case "boolean":  return { type: "boolean", ...desc };
    case "array":    return { type: "array", items: schema.inner ? toJsonSchema(schema.inner) : {}, ...desc };
    case "record":   return { type: "object", additionalProperties: schema.inner ? toJsonSchema(schema.inner) : true, ...desc };
    case "optional": return schema.inner ? { ...toJsonSchema(schema.inner), ...desc } : { ...desc };
    case "object": {
      const properties: Record<string, unknown> = {};
      const required = [];
      for (const [k, f] of Object.entries(schema.shape ?? {})) {
        properties[k] = toJsonSchema(f);
        if (f.kind !== "optional" && !f.defaultValue) required.push(k);
      }
      return { type: "object", properties, required, ...desc };
    }
    default: return { ...desc };
  }
}
