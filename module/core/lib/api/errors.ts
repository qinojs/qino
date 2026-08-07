import type { StandardIssue } from "../StandardSchema.ts";

export class ApiError extends Error {
  #status: number;
  #issues: readonly StandardIssue[] | undefined;
  get status(): number { return this.#status; }
  get issues(): readonly StandardIssue[] | undefined { return this.#issues; }

  constructor(status: number, message: string, issues?: readonly StandardIssue[]) {
    super(message);
    this.name = this.constructor.name;
    this.#status = status;
    this.#issues = issues;
  }
}

export class AccessError extends ApiError { constructor(message = "Access denied") { super(403, message); } }
export class NotFoundError extends ApiError { constructor(message = "Not found") { super(404, message); } }
export class ConflictError extends ApiError { constructor(message = "Conflict") { super(409, message); } }
export class ValidationError extends ApiError {
  constructor(issues: readonly StandardIssue[], where = "input") {
    super(422, `Validation failed (${where})`, issues);
  }
}
