import { editor } from "@qino/u2/js/rte/rte.js";
import { aiView } from "@qino/u2/js/rte/ai.js";
import { api } from "@qino/pub/api.js";

// The field's html travels as the message context, so the bot's system prompt carries the current
// text; the chat session holds the thread of prompts and answers.
let htmlDiff = null;
// One chat session per field: a follow-up like "kürze weiter" keeps the thread, another field
// starts its own instead of dragging whole earlier answers along.
const sessions = new WeakMap();

// Plain strings on purpose: t() answers with a promise, and awaiting it here would hold the whole
// module — and with it the toolbar entry — hostage to one api call.
editor.add(aiView({
  label: "Assistant",
  prompts: ["Korrigiere", "Kürze", "Fahre fort", "Schlüsselwörter fett"],
  request: async ({ prompt, html, surface }) => {
    if (!sessions.has(surface)) sessions.set(surface, api.ai.sessions.post({ bot: "rte" }).then(r => r.id));
    // Only what is actually restricted: an unset list means "no rule", and a rule nobody made
    // would cost tokens on every question.
    const { elements, classes } = surface.config;
    const context = { html };
    if (elements) context.elements = elements;
    if (classes?.length) context.classes = classes;
    return await api.ai.sessions(await sessions.get(surface)).messages.post({ content: prompt, context });
  },
  // Comparing two html strings is a library's job, fetched when the pane is first filled.
  diff: async (original, edited) => {
    htmlDiff ??= import("https://cdn.jsdelivr.net/npm/htmldiff-js@1.0.5/+esm")
      .then(module => module.default.default ?? module.default);
    return (await htmlDiff).execute(original, edited);
  },
}));
