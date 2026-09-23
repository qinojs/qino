import type { App } from "./App.ts";
import type { HtmlString } from "./util.ts";

/** The {{name|fallback}} syntax shared by template renderers. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

export type TemplateValue = { text: string; html?: HtmlString };
export type TemplatePlaceholder<Subject = unknown> = (app: App, subject: Subject) => Promise<TemplateValue | undefined>;

/** Replace in one pass: values and fallbacks are never expanded again. */
export function fillPlaceholders(text: string, value: (name: string) => string | undefined): string {
  return text.replace(PLACEHOLDER, (_all, name, fallback = "") => value(name) || fallback);
}

/** The placeholders used in a template text. */
export function placeholderNames(...texts: (string | undefined)[]): Set<string> {
  return new Set(texts.flatMap((text) => [...(text ?? "").matchAll(PLACEHOLDER)].map((hit) => hit[1])));
}

/** Names are prefixed with their module; one module's names may stay unprefixed. */
export const placeholderName = (mod: string, name: string, bare?: string) => mod === bare ? name : `${mod}.${name}`;

/** Placeholders offered by linked modules; optionally one module's names unprefixed. */
export function modulePlaceholders<Subject>(app: App, bare?: string): Record<string, TemplatePlaceholder<Subject>> {
  const all: Record<string, TemplatePlaceholder<Subject>> = {};
  for (const mod of app.modules.linked())
    for (const [name, make] of Object.entries(mod.plugin.templatePlaceholders ?? {}))
      all[placeholderName(mod.name, name, bare)] = make as TemplatePlaceholder<Subject>;
  return all;
}
