import { App, pwHash } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

Deno.test({
  name: "combined login renders its real children and configured providers without unresolved promises",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ db: "sqlite::memory:", dir });
    app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.login");
    try {
      await app.init();
      const root = await cms(app).node(1);
      const login = await root.child("login", { module: "cms.cont.login", access: 1 });
      await login.title("en", "Login");
      const cookies = new Map<string, string>();
      const request = async (body?: URLSearchParams, query = "") => {
        const res = await app.fetch(new Request("http://localhost/en/login" + query, {
          method: body ? "POST" : "GET", body,
          headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
        }));
        for (const cookie of res.headers.getSetCookie()) {
          const [name, ...value] = cookie.split(";", 1)[0].split("=");
          cookies.set(name, value.join("="));
        }
        assertEquals(res.status, 200);
        return res.text();
      };
      const initial = await request();
      assert(initial.includes('qcms-mod="cont.login.password"'));
      assert(initial.includes('qcms-mod="cont.login.webauthn"'));
      assert(initial.includes("name=csrfToken"));
      assert(!initial.includes("[object Promise]"));
      assert(!initial.includes("oauth/start/"));
      const passkey = initial.match(/<form[^>]*qcms-mod="cont.login.webauthn"[\s\S]*?<\/form>/)?.[0] ?? "";
      assert(passkey.includes("data-action=login"));
      assert(!passkey.includes("name=email"));
      await app.db.table("oauth_provider").insert({ name: 'custom"><test>', client_id: "configured" });
      const configured = await request();
      assert(configured.includes("oauth/start/custom%22%3E%3Ctest%3E"));
      assert(configured.includes("custom&quot;&gt;&lt;test&gt;"));
      assert(!configured.includes("[object Promise]"));
      assertEquals((await login.conts()).length, 4);
      const usrId = await app.db.table("usr").insert({ username: "known@example.test", active: true, pw: await pwHash("test password") });
      const csrfToken = configured.match(/name=csrfToken value="([^"]+)"/)?.[1];
      assert(csrfToken);
      const signedIn = await request(new URLSearchParams({ core_login: "", csrfToken, email: "known@example.test", pw: "test password" }));
      assert(signedIn.includes("name=core_logout"));
      assert(!signedIn.includes("name=core_login"));
      assert(!signedIn.includes("data-action=login"));
      assert(!signedIn.includes("oauth/start/"));
      assertEquals((await login.conts()).length, 5);
      await app.db.table("usr").update(usrId, { superuser: true });
      const editing = await request(undefined, "?cms_editmode=1");
      assert(editing.includes("name=core_logout"));
      assert(editing.includes("name=core_login"));
      assert(editing.includes("data-action=login"));
      assert(editing.includes("oauth/start/"));
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
