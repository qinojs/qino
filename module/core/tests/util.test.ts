import { assertEquals, assertThrows } from "./deps.ts";
import {
  HtmlString,
  OutputError,
  appRequestUriToLocalPath,
  assertAllowedPath,
  ensureSlash,
  hee,
  html,
  sqlSearchHelper,
  urlize,
} from "../lib/util.ts";

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

Deno.test("util: urlize transliterates and normalizes text", () => {
  assertEquals(urlize(" Äpfel & Öl — 100% "), "apfel-and-ol-100");
  assertEquals(urlize("foo---bar"), "foo-bar");
});

Deno.test("util: small string helpers", () => {
  assertEquals(ensureSlash("/tmp/qino"), "/tmp/qino/");
  assertEquals(ensureSlash("/tmp/qino/"), "/tmp/qino/");
});

Deno.test("util: sqlSearchHelper builds parameterized LIKE fragments", () => {
  const res = sqlSearchHelper(" alpha beta gamma delta epsilon ", ["title", "body"]);
  assertEquals(res.where, "(title LIKE ? OR body LIKE ?) AND (title LIKE ? OR body LIKE ?) AND (title LIKE ? OR body LIKE ?) AND (title LIKE ? OR body LIKE ?)");
  assertEquals(res.whereParams, ["%alpha%", "%alpha%", "%beta%", "%beta%", "%gamma%", "%gamma%", "%delta%", "%delta%"]);
  assertEquals(res.orderParams, ["alpha%", "alpha%", "beta%", "beta%", "gamma%", "gamma%", "delta%", "delta%"]);
});

Deno.test("util: appRequestUriToLocalPath maps module and qg public files", () => {
  const app = {
    appPATH: "/app/",
    modules: {
      get(name: string) {
        return name === "cms.foo" ? { dir: "/sys/cms.foo/" } : undefined;
      },
    },
  };
  assertEquals(appRequestUriToLocalPath("m/cms.foo/pub/main.css", app as never), "/sys/cms.foo/pub/main.css");
  assertEquals(appRequestUriToLocalPath("m/local.foo/pub/main.css", app as never), "/app/m/local.foo/pub/main.css");
  assertEquals(appRequestUriToLocalPath("qg/custom/pub/main.css", app as never), "/app/qg/custom/pub/main.css");
  assertEquals(appRequestUriToLocalPath("other/main.css", app as never), null);
});

Deno.test("util: assertAllowedPath accepts app/module roots and rejects siblings", () => {
  const app = {
    appPATH: "/var/www/workplace/qinojs/demo/",
    modules: {
      all() {
        return { "cms.foo": { dir: "/var/www/workplace/qinojs/qino/module/cms.foo/" } };
      },
    },
  };
  assertAllowedPath("/var/www/workplace/qinojs/demo/qg/file/a.txt", app as never);
  assertAllowedPath("/var/www/workplace/qinojs/qino/module/cms.foo/pub/a.css", app as never);
  assertThrows(
    () => assertAllowedPath("/var/www/workplace/qinojs/other/a.txt", app as never),
    OutputError,
  );
});
