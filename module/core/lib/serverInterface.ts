import { getCtx } from "./context.ts";
import { AnswerError } from "./util.ts";

/** Send JSON response and stop processing */
export function answer(data: Record<string, unknown>): never {
    const ctx = getCtx();
    if (ctx.state.Answer) Object.assign(data, ctx.state.Answer);
    throw new AnswerError(data);
}
