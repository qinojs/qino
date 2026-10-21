import { App, sys } from "@qino/qino";

export const app = new App({
  dir: import.meta.resolve("./"),
  trustedProxyHops: 1,
  db: `sqlite:${import.meta.dirname}/data/app.sqlite`,
});
app.stores.add(import.meta.resolve("./qino/module/store.json")).add("starter.account");
await app.init();
if (app.modules.failures().size) throw new Error(JSON.stringify([...app.modules.failures()]));

if (import.meta.main) {
  const port = Number(sys.env("PORT"));
  if (!port) throw new Error("PORT is required");
  console.log(`Qino ready: ${app.modules.linked().length} modules on 127.0.0.1:${port}`);
  sys.serve({ port, hostname: "127.0.0.1" }, app.fetch);
}
