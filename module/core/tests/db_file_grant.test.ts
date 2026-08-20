import { requestStorage } from "../mod.ts";
import { assertEquals, DbFileManager, testContext } from "./deps.ts";

function session() {
  let key = "";
  return { data: { core: {
    userId: () => 0,
    grantKey: (value?: string) => value === undefined ? key : (key = value),
  } } };
}

Deno.test("DbFile session grants allow only the signed file variant", async () => {
  const dir = await Deno.makeTempDir();
  const vs = { id: 7, name: "private file.txt", mime: "text/plain", md5: "abcdef0123456789", access: 0 };
  await Deno.writeTextFile(dir + "/" + vs.md5, "private");
  const app = {
    db: { row: () => Promise.resolve(vs) },
    fire: (_name: string, event: unknown) => Promise.resolve(event),
    fileTransformer: {
      transform: (path: string, _options: unknown, mime: string) => Promise.resolve({ path, mime, transformed: false }),
    },
  };
  const dbFiles = new DbFileManager(app as never, dir);
  Object.assign(app, { dbFiles });
  const own = session();

  try {
    const issueCtx = await testContext({ url: "http://qino.test/cms2/page", app, sess: own, appUrl: "/cms2/" });
    const signed = await requestStorage.run(issueCtx, async () =>
      await (await dbFiles.file(vs.id, vs)).url({ grant: "session" })
    );
    const url = new URL(signed, "http://qino.test");
    assertEquals(url.searchParams.get("sig")?.length, 22);

    const serve = async (requestUrl: URL, sess = own) => {
      const ctx = await testContext({ url: requestUrl.href, app, sess, appUrl: "/cms2/" });
      return requestStorage.run(ctx, () => dbFiles.output(ctx.req.appPath.slice("dbFile/".length), ctx.req.raw));
    };
    const response = await serve(url);
    assertEquals([response.status, await response.text()], [200, "private"]);
    assertEquals((await serve(url, session())).status, 403);

    const changed = new URL(url);
    const parts = changed.pathname.split("/");
    parts.splice(-1, 0, "dl");
    changed.pathname = parts.join("/");
    assertEquals((await serve(changed)).status, 403);

    vs.access = 1;
    const publicSession = { data: { core: {
      userId: () => 0,
      grantKey: () => { throw new Error("Public files must not check grants"); },
    } } };
    assertEquals((await serve(changed, publicSession)).status, 200);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
