import { editor } from "@qino/u2/js/rte/rte.js";
import { aiView } from "@qino/u2/js/rte/ai.js";
import { api } from "@qino/pub/api.js";

// The field's html is sent as context (in the system prompt); the chat session keeps the thread.
let htmlDiff = null;
// One chat session per field, so follow-ups keep the thread and other fields start fresh.
const sessions = new WeakMap();

// Plain strings: awaiting t() here would delay the module and its toolbar entry.
editor.add(aiView({
  label: "Assistant",
  prompts: ["Korrigiere", "Kürze", "Fahre fort", "Schlüsselwörter fett"],
  request: async ({ prompt, html, surface }) => {
    if (!sessions.has(surface)) sessions.set(surface, api.ai.sessions.post({ bot: "rte" }).then(r => r.id));
    // Only real restrictions; an unset list means no rule (saves tokens).
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
