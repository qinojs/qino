import type { StandardIssue } from "../StandardSchema.ts";

export class AptError extends Error {
  constructor(public readonly status: number, message: string, public readonly issues?: readonly StandardIssue[]) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AccessError extends AptError { constructor(message = "Access denied") { super(403, message); } }
export class NotFoundError extends AptError { constructor(message = "Not found") { super(404, message); } }
export class ConflictError extends AptError { constructor(message = "Conflict") { super(409, message); } }
export class ValidationError extends AptError {
  constructor(issues: readonly StandardIssue[], where = "input") {
    super(422, `Validation failed (${where})`, issues);
  }
}
