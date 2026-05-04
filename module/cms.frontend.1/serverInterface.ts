/**
 * cms.frontend.1/serverInterface.ts
 * Port of cms.frontend.1/qg.php — class serverInterface_cms_frontend_1
 */

import { serverInterface } from "../core/lib/serverInterface.ts";

serverInterface["cms_frontend_1"] = {
  async widget(widget: string, params: Record<string, any> = {}): Promise<string | null | false> {
    return this.ctx.app.apt["cms.frontend.1"].widget(widget).post({ params });
  },
};
