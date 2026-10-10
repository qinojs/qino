import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { aiView } from "@qino/u2/js/rte/ai.js";
import { editor } from "@qino/u2/js/rte/rte.js";

// The editor's assistant, answered by ai (`ai.api` text). One thread
// per field, so follow-ups go on from the last answer and other fields start fresh.

const RULES = `You are a text editor working on one field of a website.
The user sends an instruction and the field's current html. Answer with the full edited html and
nothing else — no explanation, no code fence, no markdown.

- Keep the user's language unless the instruction asks otherwise.
- Never invent links or image sources, and leave the src and href of existing ones untouched.`;

/** Simple tasks: speed and cost weigh more than quality (ai `prefer`). */
const PREFER = { speed: 5, cost: 5, quality: 1 };

let htmlDiff;
const threads = new WeakMap();

// one batch, and cached after the first page
const [label, ...prompts] = await Promise.all([t`Assistant`, t`Correct`, t`Shorten`, t`Continue`, t`Bold the keywords`]);

editor.add(aiView({
  label,
  prompts,
  request: async ({ prompt, html, surface }) => {
    if (!threads.has(surface)) {
      // what the field allows, so the answer's markup survives the sanitizer; an unset list is no rule
      const { elements, classes } = surface.config;
      const system = [RULES, elements && `This field allows only these tags: ${elements.join(" ")}`, classes?.length && `Classes you may use, and no others: ${classes.join(" ")}`];
      threads.set(surface, { messages: [{ role: "system", content: system.filter(Boolean).join("\n") }] });
    }
    const thread = threads.get(surface), messages = thread.messages;
    // the field goes along when it changed since, else the last answer is what the prompt is about
    messages.push({ role: "user", content: html === thread.html ? prompt : `${prompt}\n\nCurrent field:\n${html}` });
    const result = await api["ai.api"].text.post({ messages, opts: { prefer: PREFER } }).catch((e) => { messages.pop(); throw e; });
console.log(result);
    const text = result?.text ?? "";
    thread.html = html;
    messages.push({ role: "assistant", content: text });
    return text;
  },
  // Comparing two html strings is a library's job, fetched when the pane is first filled.
  diff: async (original, edited) => {
    htmlDiff ??= import("https://cdn.jsdelivr.net/npm/htmldiff-js@1.0.5/+esm").then((module) => module.default.default ?? module.default);
    return (await htmlDiff).execute(original, edited);
  },
}));
