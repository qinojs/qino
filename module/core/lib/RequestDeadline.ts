import { Output } from "./util.ts";
import type { RequestContext } from "./RequestContext.ts";

/** Cooperative request time limit: `left` seconds count down, then `signal` aborts with a 504 Output. */
export class RequestDeadline {
  #ctrl = new AbortController();
  #deadline = Infinity;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Aborts on client disconnect or timeout — pass to fetch/db calls. */
  readonly signal: AbortSignal;

  constructor(ctx: RequestContext) {
    this.signal = AbortSignal.any([ctx.req.raw.signal, this.#ctrl.signal]);
  }

  /** Remaining seconds; `Infinity` = no limit (default). Setting re-arms the timer: `deadline.left += 60`. */
  get left(): number {
    return this.#deadline === Infinity ? Infinity : Math.max(0, (this.#deadline - Date.now()) / 1000);
  }
  set left(seconds: number) {
    clearTimeout(this.#timer);
    this.#deadline = seconds === Infinity ? Infinity : Date.now() + seconds * 1000;
    if (this.#deadline === Infinity) return;
    this.#timer = setTimeout(
      () => this.#ctrl.abort(new Output("Gateway Timeout", { status: 504 })),
      Math.max(0, seconds) * 1000,
    );
  }

  clear(): void { clearTimeout(this.#timer); }
}
