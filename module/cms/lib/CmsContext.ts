import type { Node } from "./Node.ts";

// Pro-Request CMS-Kontext, vom cms-Modul auf `ctx.cms` installiert (siehe plugin.ts).
// Liegt auf dem Request-Objekt, weil die Daten pro-Request sind — App-Singleton-Umweg
// (früher `app.cms.MainNode` via getCtx) entfällt. Core kennt cms nicht.
export class CmsContext {
  mainNode!: Node;
  requestedNode!: Node;
  editmode = 0;
  renderPath: Set<number> = new Set();
  accessCache: Record<string, number> = {};
  get nodeId(): number | undefined { return this.mainNode?.id; }
  get requestedNodeId(): number | undefined { return this.requestedNode?.id; }
}
