import { hee } from "@qino/qino";

import { htmlOf, textOf, textToHtml } from "./format.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "../mod.ts";
import type { Profile } from "./format.ts";

// A template is the frame a channel puts around every message: `{{content}}` is the message
// itself, every other marker is what this channel knows about the recipient. The frame belongs to
// the channel, so the same message arrives as a signed mail and as a bare line of SMS.

const MARKER = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g;
const CONTENT = "{{content}}";
const DEFAULT = "default";

/**
 * Load the message's frame once, then render the message for each recipient.
 *
 * The result has markup whenever the message or its frame has any. `to` is the recipient row the
 * channel already holds — its columns are the markers, and a missing one falls back to what the
 * marker names after `|`.
 */
export async function renderer(
  app: App,
  msg: Msg,
  channel: string,
  profile: Profile = "html",
): Promise<(to?: Row) => { text: string; html?: string }> {
  const frame = msg.template === "" ? undefined : await load(app, msg.template || DEFAULT, channel);
  const text = textOf(msg);
  const html = htmlOf(msg, profile);
  const frameText = frame ? textOf(frame) : CONTENT;
  const frameHtml = frame && htmlOf(frame, profile);
  // markup on either side makes it a markup message; the plain side is lifted to match
  const markup = html !== undefined || frameHtml !== undefined;

  return (to = {}) => ({
    text: fill(frameText, text, to, false),
    html: markup ? fill(frameHtml ?? textToHtml(frameText, profile), html ?? textToHtml(text, profile), to, true) : undefined,
  });
}

/** Every template, newest channel variants of one name together. */
export function templates(app: App): Promise<Row[]> {
  return app.db.query`SELECT * FROM message_template ORDER BY name, channel`;
}

/** The channel's variant of that template; an unknown name simply has no frame. */
function load(app: App, name: string, channel: string): Promise<Msg | undefined> {
  return app.db.row<Msg>`SELECT text, format FROM message_template
    WHERE name = ${name} AND channel = ${channel}`;
}

/** The message goes in as it is — it was rendered for this target already; markers do not. */
function fill(frame: string, content: string, to: Row, escape: boolean): string {
  return frame.replace(MARKER, (_, key, fallback = "") => {
    if (key === "content") return content;
    const value = String(to[key] ?? "") || fallback;
    return escape ? hee(value) : value;
  });
}
