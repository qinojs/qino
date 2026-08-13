import { html } from "@qino/qino";
import { formOf } from "@qino/qino/cms.cont.form2";

import options from "./options.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    accept: { type: "string", description: "Accepted MIME types, e.g. \"image/*, application/pdf\"." },
    required: { type: "boolean", description: "The form cannot be sent without a file." },
    multiple: { type: "boolean", description: "Allows selecting more than one file." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const settings = node.settings;
  const fieldName = "file" + node.id;
  const form = await formOf(node);

  if (form?.sent) {
    // ReqBody keeps only the last file per field name, so `multiple` still yields a single attachment
    const file = await ctx.req.files[fieldName]?.catch(() => undefined);
    if (file?.name) form.attachments.push({ path: file.tmpPath, name: file.name });
    else if (settings.required()) form.errors++;
  }

  if (node.edit) ctx.res.html.scripts.add(node.modUrl + "pub/edit.mjs");

  return html.async`<div>
  <input type=file name="${fieldName}" accept="${String(settings.accept() ?? "").trim()}"${settings.multiple() ? html.raw(" multiple") : ""}${settings.required() ? html.raw(" required") : ""}>
  <p class=-sizeWarning hidden>${node.app.t`The attachments exceed 25 MB — the e-mail may not get through.`}</p>
</div>`;
}

export const cms = {
  node: {
    render,
    options,
    settingsSchema,
    js: ["pub/main.mjs"],
  },
};
