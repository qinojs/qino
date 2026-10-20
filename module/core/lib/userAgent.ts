const UA_TESTS: [string, RegExp][] = [
  ["Claude", /Claude\/([\d.]+)/],
  ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
  ["Samsung", /SamsungBrowser\/([\d.]+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
  ["Safari", /(?:Version\/([\d.]+).*)?Safari\//], // in-app WebKit views (Google app, …) carry no Version
];

const OS_TESTS: [string, RegExp][] = [
  ["Windows", /Windows/],
  ["Android", /Android/],
  ["iOS", /iPhone|iPad|iPod/],
  ["ChromeOS", /CrOS/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Linux", /Linux/],
];

/** Lightweight user-agent classification (browser + version, OS, mobile and bot flags). */
export function uaInfo(ua: string): { browser: string; version: string; os: string; mobile: boolean; bot: boolean } {
  const bot = !ua || /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternal|headless|preview|monitor/i.test(ua) ||
    /http-?client|curl|wget|python|java\/|okhttp|axios|undici|node-fetch|libwww|scrapy|networkingextension/i.test(ua); // HTTP libraries
  const os = OS_TESTS.find(([, re]) => re.test(ua))?.[0] ?? "";
  const mobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
  const [browser, m] = UA_TESTS.map(([name, re]) => [name, re.exec(ua)] as const).find(([, m]) => m) ?? [ua ? "?" : "-", null];
  return { browser, version: m?.[1] ?? "", os, mobile, bot };
}
