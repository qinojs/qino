// deno-lint-ignore-file no-explicit-any
import { runInNewContext } from "node:vm";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.image2: client resizes raster URLs and preserves SVG sources", async () => {
  const source = await Deno.readTextFile(new URL("../pub/cms-image2.js", import.meta.url));
  for (const [url, expected] of [
    ["/dbFile/1/u-svg/logo.svg", "/dbFile/1/u-svg/logo.svg"],
    ["/dbFile/1/u-svg/q-37/logo.svg", "/dbFile/1/u-svg/q-37/logo.svg"],
    ["/dbFile/1/u-img/w-100/h-50/q-85/photo.jpg", "/dbFile/1/u-img/w-210/h-120/q-85/dpr-2/photo.jpg"],
    ["data:image/svg+xml,%3Csvg/%3E", "data:image/svg+xml,%3Csvg/%3E"],
  ]) {
    let intersect: any;
    const requests: string[] = [];
    const attrs = new Set<string>();
    const element = {
      querySelector: () => ({ textContent: "" }),
      prepend: () => {},
      hasAttribute: (name: string) => attrs.has(name),
      setAttribute: (name: string) => attrs.add(name),
      style: { backgroundImage: "" },
    };
    const img = { src: url, parentNode: element, removeAttribute: () => {}, addEventListener: () => {} };
    const context: any = {
      document: { createElement: () => ({ content: { firstElementChild: img } }) },
      IntersectionObserver: class {
        constructor(callback: any) { intersect = callback; }
        observe() {}
        unobserve() {}
      },
      ResizeObserver: class { observe() {} },
      Image: class {
        onload = () => {};
        set src(value: string) { requests.push(value); this.onload(); }
      },
      HTMLElement: class {},
      customElements: { define() {} },
      innerWidth: 1000,
      innerHeight: 1000,
      devicePixelRatio: 2,
      setTimeout: () => 0,
      requestAnimationFrame: (callback: () => void) => callback(),
    };
    runInNewContext(source, context);
    context.cms_image2.init(element);
    if (!url.startsWith("data:")) {
      intersect([{ target: img, boundingClientRect: { width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100 } }]);
      assertEquals(requests, [expected]);
    } else assertEquals(requests, []);
    assertEquals(img.src, expected);
    assertEquals(attrs.has("loaded"), true);
  }
});
