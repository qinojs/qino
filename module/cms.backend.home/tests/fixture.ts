import { App } from "@qino/qino";
import { fakeT } from "@qino/qino/tests";
import { save } from "@qino/qino/home";

export async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-backend-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const homeProvider = {
  name: "fake", schema: { type: "object", additionalProperties: false, properties: {
    url: { type: "string", format: "uri" }, accessToken: { type: "string", writeOnly: true },
  } },
  entities: async (_app, id) => { if (id === 2) throw new Error("<offline>"); return [{ id: "sensor.temp", name: "Temperature", state: 21.5, unit: "°C", available: true, attributes: {} }]; },
  actions: async () => [{ id: "set", name: "Set", fields: { value: { required: true } } }],
  call: async (_app, _id, action, input) => ({ action, input }),
};
`);
  for (const name of ["home", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init(); app.t = fakeT;
  const provider = await save(app, { name: "House", adapter: "fake", url: "http://house.test/", config: { accessToken: "saved-secret" } });
  return { app, provider, close: async () => { app.modules.unlink("home.record"); app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}
