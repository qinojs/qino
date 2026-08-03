import { html, type HtmlString } from "../../core/mod.ts";

/** Render a timestamp (unix seconds, numeric string, Date or date string) as a relative <u2-time>; epoch/invalid → "-".
 *  `narrow` shortens the wording for dense tables: "8d ago" instead of "8 days ago". */
export function time(value: unknown, { narrow }: { narrow?: boolean } = {}): HtmlString {
  if (value == null || value === "") return html`-`;
  const date = value instanceof Date ? value
    : Number.isFinite(Number(value)) ? new Date(Number(value) * 1000)
    : new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return html`-`;
  const iso = date.toISOString();
  return html`<u2-time datetime="${iso}" type=relative minute ${narrow ? "mode=narrow" : ""}>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
}
