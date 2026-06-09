import { AiApi } from "./mod.ts";
import type { App, RequestContext } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "ai";
export const needs = ["core"];
export { api } from "./apt.ts";

export function init(app: Pick<App, "aptTree" | "on" | "settings"> & { ai?: AiApi }) {
  app.ai = new AiApi(app);

  app.on("cms-ready", e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.cms.editmode) return;
    ctx.html.scripts.add(ctx.sysURL + "ai/pub/chat.js");
    ctx.html.content += `
      <style>
          .cmsChatWrapper {
            position:fixed;
            top:3rem;
            left:3rem;
            z-index:9000;
            background:var(--color-bg);
            color:var(--color-text);
            box-shadow:0 0 1rem rgba(0,0,0,.3);
            font-size:14px;
            display:flex;
            flex-direction:column;
            max-height:70vh;
          }
          .cmsChatWrapper ai-chat {
            height:100%;
          }
      </style>
      <div xonmousedown="event.stopPropagation();">
        <div u2-movable class="cmsChatWrapper qgCMS" style="position:fixed;top:80px;left:16px;">
          <div u2-movable-handler style="background:var(--cms-color); color:#fff; padding:.5rem; cursor:move">CMS Helper</div>
          <ai-chat bot="cms-helper"></ai-chat>
        </div>
      </div>`;
  });
}

export async function install({ app }: { app: App }): Promise<void> {
  const settings = app.settings.ai;

  if (!await settings.default.provider) settings.default.provider("groq.com");

  const currentModel = String(await settings.default.model ?? "");
  if (!currentModel || currentModel.startsWith("moonshotai/")) {
    settings.default.model("llama-3.3-70b-versatile");
  }

  if (!await settings.default.embedding_provider) settings.default.embedding_provider("jina.ai");
  if (!await settings.default.embedding_model) settings.default.embedding_model("jina-embeddings-v3");

  settings.provider["groq.com"].key;
  settings.provider["openai.com"].key;
  settings.provider["nvidia.com"].key;
  settings.provider["openrouter.ai"].key;
  settings.provider["jina.ai"].key;
  settings.provider["x-ai"].key;
  settings.provider["x-ai"].models;
  settings.provider["x-ai"].default_model;
  settings.provider["x-ai"].models_synced_at;
  settings.provider["aihubmix.com"].key;
  settings.provider["aihubmix.com"].models;
  settings.provider["aihubmix.com"].default_model;
  settings.provider["aihubmix.com"].models_synced_at;
  settings.provider["aihubmix.com"].used_input_tokens;
  settings.provider["aihubmix.com"].used_output_tokens;
  settings.provider["groq.com"].models;
  settings.provider["openai.com"].models;
  settings.provider["nvidia.com"].models;
  settings.provider["openrouter.ai"].models;
  settings.provider["groq.com"].default_model;
  settings.provider["openai.com"].default_model;
  settings.provider["nvidia.com"].default_model;
  settings.provider["openrouter.ai"].default_model;
  settings.provider["groq.com"].models_synced_at;
  settings.provider["openai.com"].models_synced_at;
  settings.provider["nvidia.com"].models_synced_at;
  settings.provider["openrouter.ai"].models_synced_at;
  settings.provider["groq.com"].used_input_tokens;
  settings.provider["groq.com"].used_output_tokens;
  settings.provider["openai.com"].used_input_tokens;
  settings.provider["openai.com"].used_output_tokens;
  settings.provider["nvidia.com"].used_input_tokens;
  settings.provider["nvidia.com"].used_output_tokens;
  settings.provider["openrouter.ai"].used_input_tokens;
  settings.provider["openrouter.ai"].used_output_tokens;
  settings.provider["jina.ai"].used_input_tokens;
}
