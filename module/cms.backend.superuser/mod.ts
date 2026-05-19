// deno-lint-ignore-file no-explicit-any
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import { hee } from "../core/lib/util.ts";

export const name = "cms.backend.superuser";
export const needs = ["cms.backend"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.superuser");
  if (P) {
    await P.title("en", "Superuser");
    await P.title("de", "Superuser");
  }
}

async function render(node: Node): Promise<string> {
  const page = await node.page();
  const children = [...(await page.children({ access: 1 })).values()];
  if (!children.length) return "<div></div>";
  const links = await Promise.all(children.map(async (child: any) =>
    `<a href="${hee(await child.url())}">${hee(await (await child.title()).string())}</a><br>`
  ));

  return `<div class="u2-card" style="flex:0 1 600px">
  <div class="-head">${hee(String(await (await page.title()).string() ?? "Superuser"))}</div>
  <div class="-body">
    ${links.join("")}
  </div>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
