/**
 * core/serverInterface.ts - Core server interface classes
 * Port of core/serverInterface.php
 */
// deno-lint-ignore-file no-explicit-any

import { serverInterface } from "./lib/serverInterface.ts";

serverInterface.core = {
  async changePw(v: { oldpw: string; pw: string }): Promise<number> {
    return this.ctx.app.apt.core.password.put(v);
  },

  async logout(): Promise<void> {
    await this.ctx.app.apt.core.logout.post();
  },
};
