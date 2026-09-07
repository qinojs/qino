import type { App } from "./App.ts";
import type { HtmlString } from "./util.ts";

/** The deliberately small {{name|fallback}} syntax shared by template renderers. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

export type TemplateValue = { text: string; html?: HtmlString };
export type TemplatePlaceholder<Subject = unknown> = (app: App, subject: Subject) => Promise<TemplateValue | undefined>;

/** Replace once only: values and fallbacks stay literal, never becoming placeholders themselves. */
export function fillPlaceholders(text: string, value: (name: string) => string | undefined): string {
  return text.replace(PLACEHOLDER, (_all, name, fallback = "") => value(name) || fallback);
}

/** The placeholders static template text asks for. */
export function placeholderNames(...texts: (string | undefined)[]): Set<string> {
  return new Set(texts.flatMap((text) => [...(text ?? "").matchAll(PLACEHOLDER)].map((hit) => hit[1])));
}

/** A module owns its namespace; one consumer may keep its own base vocabulary bare. */
export const placeholderName = (mod: string, name: string, bare?: string) => mod === bare ? name : `${mod}.${name}`;

/** What linked modules deliberately offer to templates, optionally leaving one module's names bare. */
export function modulePlaceholders<Subject>(app: App, bare?: string): Record<string, TemplatePlaceholder<Subject>> {
  const all: Record<string, TemplatePlaceholder<Subject>> = {};
  for (const mod of app.modules.linked())
    for (const [name, make] of Object.entries(mod.plugin.templatePlaceholders ?? {}))
      all[placeholderName(mod.name, name, bare)] = make as TemplatePlaceholder<Subject>;
  return all;
}
