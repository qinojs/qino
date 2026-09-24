import type { TranslateInput } from "../mod.ts";
import type { Adapter } from "./run.ts";

// Translation services. Endpoints: https://api.deepl.com/v2, https://translation.googleapis.com/language/translate/v2

export const deepl: Adapter = {
  translate: async (call, { text, to, from, format }: TranslateInput) => {
    const res = await call.fetch("/translate", {
      method: "POST",
      headers: { authorization: "DeepL-Auth-Key " + call.key },
      body: new URLSearchParams({ text, target_lang: to, ...from && { source_lang: from }, ...format === "html" && { tag_handling: "html" } }),
    });
    call.usage(text.length);
    return (await res.json()).translations[0].text;
  },
};

export const google: Adapter = {
  translate: async (call, { text, to, from, format }: TranslateInput) => {
    const res = await call.fetch("?" + new URLSearchParams({ q: text, target: to, format: format === "html" ? "html" : "text", ...from && { source: from }, key: call.key }));
    call.usage(text.length);
    return (await res.json()).data.translations[0].translatedText;
  },
};
