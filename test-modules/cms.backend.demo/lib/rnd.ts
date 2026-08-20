// Deterministic pseudo-randomness: the same seed always rebuilds the same demo site, so a bug
// found in seeded data can be reproduced by anyone who runs the module.

const FIRST = "Anna Ben Clara David Elena Felix Greta Hugo Ida Jonas Karin Liam Mara Noah Olivia Paul Quinn Rosa Samuel Tina Uwe Vera Willem Xenia Yara Zoe Amir Bianca Cem Dilara Eero Fatima Gustav Hana Igor Julia Kenji Lucia Malik Nina Omar Petra Rafael Sofia Tarek Ulla Viktor Wanda Yusuf Zeynep".split(" ");
const LAST = "Ackermann Bauer Costa Dubois Ehrler Fischer Gruber Huber Iversen Jensen Keller Lombardi Meier Novak Olsen Peters Quadri Richter Schneider Tanner Ulrich Vogel Weber Yilmaz Zimmermann Andersson Brunner Cavallo Dimitrov Fontaine".split(" ");
const COMPANY = ["Nordwind AG", "Blue Harbour Ltd", "Studio Kestrel", "Alpine Robotics", "Pico Verlag", "Havel & Söhne", "Lumen Design", "Terra Foods", "Kranich Media", "Delta Works", ""];
const CITY = "Zurich Berlin Vienna Lisbon Oslo Prague Bologna Ghent Tallinn Lyon".split(" ");
const WORDS = "aurora basalt cadence delta ember fathom gossamer harbour indigo juniper kestrel lumen meadow nimbus onyx pallet quarry ripple solstice tundra umbra verdant willow xenon yonder zephyr signal cluster fabric lattice orbit prism vector".split(" ");
const TOPIC = ["Getting started", "Field notes", "Behind the scenes", "Release", "How we work", "A short history", "Numbers of the month", "Questions we get", "On the road", "Small things", "Workshop report", "What changed"];
const SUBJECT = ["Your order has shipped", "Welcome aboard", "Password reset", "Monthly report", "Invitation to the workshop", "Invoice {n}", "We updated our terms", "Your account is ready", "Newsletter {n}", "Reminder: appointment"];
const UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
];
const REFERER = ["", "", "", "https://www.google.com/", "https://duckduckgo.com/", "https://news.ycombinator.com/", "https://mastodon.social/"];

export class Rnd {
  #s: number;

  constructor(seed = 0x1a2b3c4d) { this.#s = seed >>> 0; }

  /** mulberry32 */
  next(): number {
    this.#s = (this.#s + 0x6d2b79f5) >>> 0;
    let t = this.#s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(list: readonly T[]): T { return list[this.int(0, list.length - 1)]; }
  /** `n` distinct entries, or fewer when the list is shorter. */
  some<T>(list: readonly T[], n: number): T[] {
    const rest = [...list];
    const out: T[] = [];
    while (out.length < n && rest.length) out.push(rest.splice(this.int(0, rest.length - 1), 1)[0]);
    return out;
  }

  words(n: number): string { return Array.from({ length: n }, () => this.pick(WORDS)).join(" "); }
  sentence(): string { const s = this.words(this.int(6, 14)); return s[0].toUpperCase() + s.slice(1) + this.pick([".", ".", ".", "?", "!"]); }
  paragraph(): string { return Array.from({ length: this.int(2, 5) }, () => this.sentence()).join(" "); }
  /** A body of text as content modules store it. */
  richText(paras = this.int(2, 4)): string {
    const out = [`<p>${this.paragraph()}`];
    for (let i = 1; i < paras; i++) {
      if (this.chance(0.25)) out.push(`<h3>${this.title(3)}</h3>`);
      if (this.chance(0.15)) out.push(`<ul>${Array.from({ length: this.int(2, 4) }, () => `<li>${this.words(this.int(2, 6))}`).join("")}</ul>`);
      out.push(`<p>${this.paragraph()}`);
    }
    return out.join("\n");
  }
  title(n = this.int(1, 3)): string { const s = this.words(n); return s[0].toUpperCase() + s.slice(1); }
  topic(i: number): string { return `${this.pick(TOPIC)}: ${this.title(2)} ${i}`; }

  person(): { firstname: string; lastname: string; company: string; city: string } {
    return { firstname: this.pick(FIRST), lastname: this.pick(LAST), company: this.pick(COMPANY), city: this.pick(CITY) };
  }
  subject(n: number): string { return this.pick(SUBJECT).replace("{n}", String(n)); }
  ua(): string { return this.pick(UA); }
  referer(): string { return this.pick(REFERER); }
  ip(): string { return this.chance(0.2) ? `2001:db8:${this.int(16, 4095).toString(16)}::${this.int(1, 9999).toString(16)}` : `${this.pick([80, 91, 178, 213])}.${this.int(0, 255)}.${this.int(0, 255)}.${this.int(1, 254)}`; }

  /** A unix time within the last `days`, biased towards recent. */
  past(days: number, now: number): number {
    const f = this.next() ** 2.2; // squash towards 0 = today
    return now - Math.floor(f * days * 86400) - this.int(0, 86399);
  }

  /** An inline SVG placeholder as a data: URL — a real image file without a network. */
  image(name: string, label: string, w = 800, h = 500): string {
    const hue = this.int(0, 359);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="hsl(${hue} 45% 82%)"/>` +
      Array.from({ length: 6 }, () => `<circle cx="${this.int(0, w)}" cy="${this.int(0, h)}" r="${this.int(30, 160)}" fill="hsl(${(hue + this.int(20, 120)) % 360} 55% ${this.int(55, 88)}%)" opacity=".55"/>`).join("") +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${Math.round(h / 10)}" fill="hsl(${hue} 60% 25%)">${label.replace(/[<&>]/g, "")}</text></svg>`;
    const bytes = new TextEncoder().encode(svg);
    return `data:image/svg+xml;name=${name}.svg;base64,` + btoa(String.fromCharCode(...bytes));
  }
}
