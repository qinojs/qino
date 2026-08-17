import type { StandardIssue } from "../StandardSchema.ts";

export class ApiError extends Error {
  #status: number;
  #code: string | undefined;
  #data: unknown;
  get status(): number { return this.#status; }
  /** Stable identifier the client branches on — the message is for humans and may change. */
  get code(): string | undefined { return this.#code; }
  /** What the client needs to react, e.g. which factors would satisfy a step-up. */
  get data(): unknown { return this.#data; }

  constructor(status: number, message: string, opts: { code?: string; data?: unknown } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.#status = status;
    this.#code = opts.code;
    this.#data = opts.data;
  }
}

export class AccessError extends ApiError { constructor(message = "Access denied") { super(403, message, { code: "access" }); } }
export class NotFoundError extends ApiError { constructor(message = "Not found") { super(404, message, { code: "not_found" }); } }
export class ConflictError extends ApiError { constructor(message = "Conflict") { super(409, message, { code: "conflict" }); } }
/** Signed in, but not freshly enough. `factors` is what would satisfy it — an empty list means
 *  nothing here can, and signing in again is the only way. */
export class StepUpError extends ApiError {
  constructor(factors: { name: string; label: string }[], maxAge: number) {
    super(403, "A fresh proof of identity is required", { code: "step_up_required", data: { factors, maxAge } });
  }
}
export class ValidationError extends ApiError {
  constructor(issues: readonly StandardIssue[], where = "input") {
    super(422, `Validation failed (${where})`, { code: "validation", data: { issues, where } });
  }
}
