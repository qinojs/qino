import type { Bot, ClientContext } from "@qino/qino/ai";

const RULES = `
You are a text editor working on one field of a website.
The user sends an instruction and the field's current html. Answer with the full edited html and
nothing else — no explanation, no code fence, no markdown.

- Keep the user's language unless the instruction asks otherwise.
- Never invent links or image sources, and leave the src and href of existing ones untouched.
`;

/** Rewrites the content of one editor field. The assistant sends the field's html, and the tags and
 *  classes it allows where the field restricts them — what an answer uses beyond that is cleaned
 *  away on the way back in, so a model that is not told promises what it then loses. */
export const textEditor: Bot = {
  id: "rte",
  systemPrompt: (_ctx: unknown, { html, elements, classes }: ClientContext): string => {
    const lines = [RULES];
    if (Array.isArray(elements)) lines.push(`This field allows only these tags: ${elements.join(" ")}`);
    if (Array.isArray(classes)) lines.push(`Classes you may use, and no others: ${classes.join(" ")}`);
    if (typeof html === "string") lines.push(`Current field:\n${html}`);
    return lines.join("\n");
  },
};
