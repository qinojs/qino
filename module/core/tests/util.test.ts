import { assertEquals, assertThrows, testContext } from "./deps.ts";
import {
  HtmlString,
  Output,
  contentDisposition,
  ensureSlash,
  hee,
  html,
  sqlSearchHelper,
  urlize,
} from "../lib/util.ts";
import { App } from "../lib/App.ts";
import { fakeRender } from "./sqlFake.ts";

Deno.test("util: hee escapes HTML-sensitive characters", () => {
  assertEquals(hee(`<a href="x&y">'ok'</a>`), "&lt;a href=&quot;x&amp;y&quot;&gt;&#039;ok&#039;&lt;/a&gt;");
  assertEquals(hee(null), "");
});

Deno.test("util: html template escapes values but keeps HtmlString values", () => {
  const value = `<b>x</b>`;
  const out = html`<p>${value}${new HtmlString("<br>")}</p>`;
  assertEquals(String(out), "<p>&lt;b&gt;x&lt;/b&gt;<br></p>");
  assertEquals(String(out.escaped()), "&lt;p&gt;&amp;lt;b&amp;gt;x&amp;lt;/b&amp;gt;&lt;br&gt;&lt;/p&gt;");
});

Deno.test("util: html escapes duck-typed { html } objects, coerces HtmlString input", () => {
  const value = { html: "<b>raw</b>", toString() { return this.html; } };
  assertEquals(String(html`<p>${value}</p>`), "<p>&lt;b&gt;raw&lt;/b&gt;</p>");
  assertEquals(new HtmlString(null).html, "");
  assertEquals(new HtmlString(42).html, "42");
});

Deno.test("util: html.async awaits promises, escapes plain values, keeps HtmlString", async () => {
  const out = await html.async`<p>${Promise.resolve("<b>x</b>")} ${Promise.resolve(new HtmlString("<br>"))} ${null}</p>`;
  assertEquals(String(out), "<p>&lt;b&gt;x&lt;/b&gt; <br> </p>");
});

Deno.test("util: html.async renders renderable values (Node-like .html()) recursively", async () => {
  const node = { html: () => Promise.resolve(new HtmlString("<i>raw</i>")) }; // like a cms Node/cont
  const textNode = { html: () => Promise.resolve("<plain>") };                // html() returning a string is still escaped
  const out = await html.async`<p>${node}|${Promise.resolve(node)}|${textNode}</p>`;
  assertEquals(String(out), "<p><i>raw</i>|<i>raw</i>|&lt;plain&gt;</p>");
});

Deno.test("util: urlize transliterates and normalizes text", () => {
  assertEquals(urlize(" Äpfel & Öl — 100% "), "aepfel-and-oel-100");
  assertEquals(urlize("foo---bar"), "foo-bar");
});

Deno.test("util: small string helpers", () => {
  assertEquals(ensureSlash("/tmp/qino"), "/tmp/qino/");
  assertEquals(ensureSlash("/tmp/qino/"), "/tmp/qino/");
});

Deno.test("util: Output passes Web BodyInit objects through", async () => {
  assertEquals(await new Output(new Blob(["abc"])).toResponse().text(), "abc");
  assertEquals(await new Output(new URLSearchParams({ a: "b" })).toResponse().text(), "a=b");
});

Deno.test("util: contentDisposition encodes RFC 5987 reserved characters", () => {
  assertEquals(
    contentDisposition("attachment", "report (final)*'ä.txt"),
    "attachment; filename=\"report (final)*'_ä.txt\"; filename*=UTF-8''report%20%28final%29%2A%27%C3%A4.txt",
  );
});


Deno.test("util: sqlSearchHelper builds parameterized LIKE fragments", () => {
  const res = sqlSearchHelper(" alpha beta gamma delta epsilon ", ["title", "body"]);
  const [whereSql, whereParams] = fakeRender(res.where, []);
  assertEquals(whereSql, "(`title` LIKE ? ESCAPE '!' OR `body` LIKE ? ESCAPE '!') AND (`title` LIKE ? ESCAPE '!' OR `body` LIKE ? ESCAPE '!') AND (`title` LIKE ? ESCAPE '!' OR `body` LIKE ? ESCAPE '!') AND (`title` LIKE ? ESCAPE '!' OR `body` LIKE ? ESCAPE '!')");
  assertEquals(whereParams, ["%alpha%", "%alpha%", "%beta%", "%beta%", "%gamma%", "%gamma%", "%delta%", "%delta%"]);
  assertEquals(fakeRender(res.order, [])[1], ["alpha%", "alpha%", "beta%", "beta%", "gamma%", "gamma%", "delta%", "delta%"]);
});

Deno.test("util: ctx.urlToLocalPath maps module and qg public files", async () => {
  const ctx = await testContext({
    app: {
      appPATH: "/app/",
      modules: {
        get(name: string) {
          return name === "cms.foo" ? { dir: "/sys/cms.foo/" } : undefined;
        },
      },
    },
  });
  assertEquals(ctx.urlToLocalPath("http://h/m/cms.foo/pub/main.css"), "/sys/cms.foo/pub/main.css");
  assertEquals(ctx.urlToLocalPath("http://h/m/local.foo/pub/main.css"), "/app/m/local.foo/pub/main.css");
  assertEquals(ctx.urlToLocalPath("http://h/qg/custom/pub/main.css"), "/app/qg/custom/pub/main.css");
  assertEquals(ctx.urlToLocalPath("http://h/m/cms.foo/pub/../mod.ts"), null);
  assertEquals(ctx.urlToLocalPath("http://h/m/cms.foo/pub/../../deps.ts"), null);
  assertEquals(ctx.urlToLocalPath("http://h/qg/custom/pub/../mod.ts"), null);
  assertEquals(ctx.urlToLocalPath("http://h/other/main.css"), null);
});

Deno.test("util: app.assertAllowedPath accepts app/module roots and rejects siblings", () => {
  const app = Object.assign(Object.create(App.prototype), {
    appPATH: "/var/www/workplace/qinojs/demo/",
    modules: {
      all() {
        return { "cms.foo": { dir: "/var/www/workplace/qinojs/qino/module/cms.foo/" } };
      },
    },
  }) as App;
  app.assertAllowedPath("/var/www/workplace/qinojs/demo/qg/file/a.txt");
  app.assertAllowedPath("/var/www/workplace/qinojs/qino/module/cms.foo/pub/a.css");
  assertThrows(
    () => app.assertAllowedPath("/var/www/workplace/qinojs/other/a.txt"),
    Output,
  );
});
