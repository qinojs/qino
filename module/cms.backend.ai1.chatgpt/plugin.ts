import { backend } from "@qino/qino/cms.backend";
import { render as account } from "@qino/qino/cms.cont.my.chatgpt";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, manifest.name, { en: "ChatGPT plan", de: "ChatGPT-Abo" });
}

export const cms = { node: { render: (node: Node, { ctx }: { ctx: Ctx }) => account(node, { ctx }) } };
