import type { TranslateInput } from "../mod.ts";
import type { Adapter } from "./run.ts";

// Translation services. Endpoints: https://api.deepl.com/v2, https://translation.googleapis.com/language/translate/v2

// Both take many texts at once (repeated parameter) and answer in the same order.
const texts = (text: string | string[]) => [text].flat();
const shaped = (text: string | string[], answers: string[]) => Array.isArray(text) ? answers : answers[0];
const length = (text: string | string[]) => texts(text).join("").length;

export const deepl: Adapter = {
  translate: async (call, { text, to, from, format }: TranslateInput) => {
    const body = new URLSearchParams({ target_lang: to, ...from && { source_lang: from }, ...format === "html" && { tag_handling: "html" } });
    for (const t of texts(text)) body.append("text", t);
    const res = await call.fetch("/translate", { method: "POST", headers: { authorization: "DeepL-Auth-Key " + call.key }, body });
    call.usage(length(text));
    return shaped(text, (await res.json()).translations.map((t: { text: string }) => t.text));
  },
};

export const google: Adapter = {
  translate: async (call, { text, to, from, format }: TranslateInput) => {
    const query = new URLSearchParams({ target: to, format: format === "html" ? "html" : "text", ...from && { source: from }, key: call.key });
    for (const t of texts(text)) query.append("q", t);
    const res = await call.fetch("?" + query);
    call.usage(length(text));
    return shaped(text, (await res.json()).data.translations.map((t: { translatedText: string }) => t.translatedText));
  },
};
