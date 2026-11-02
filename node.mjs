// `node --import qinojs/node server.ts`: Node refuses TypeScript below node_modules.
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

registerHooks({
  load(url, ctx, next) {
    if (!/\/node_modules\/.*\.ts(\?|$)/.test(url)) return next(url, ctx);
    const source = stripTypeScriptTypes(readFileSync(new URL(url), "utf8"));
    return { format: "module", shortCircuit: true, source };
  },
});
