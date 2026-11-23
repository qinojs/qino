import { brotliDecompressSync, inflateSync } from "node:zlib";

/** The axes a variable font declares (`fvar`), as [min, max] per tag — empty for a static font.
 *  Reads TrueType/OpenType, WOFF and WOFF2. */
export function fontAxes(bytes: Uint8Array): Record<string, [number, number]> {
  const fvar = table(bytes, "fvar");
  if (!fvar) return {};
  const v = new DataView(fvar.buffer, fvar.byteOffset, fvar.byteLength);
  const axes: Record<string, [number, number]> = {};
  const [offset, count, size] = [v.getUint16(4), v.getUint16(8), v.getUint16(10)];
  for (let i = 0; i < count; i++) {
    const at = offset + i * size;
    axes[tag(fvar, at)] = [v.getInt32(at + 4) / 65536, v.getInt32(at + 12) / 65536];
  }
  return axes;
}

const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/** One table of the font, uncompressed. */
function table(b: Uint8Array, name: string): Uint8Array | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const signature = tag(b, 0);
  if (signature === "wOF2") return woff2(b, v, name);
  const woff = signature === "wOFF";
  const [start, step] = woff ? [44, 20] : [12, 16];
  for (let i = 0, n = v.getUint16(woff ? 12 : 4); i < n; i++) {
    const at = start + i * step;
    if (tag(b, at) !== name) continue;
    if (!woff) return b.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12));
    const [offset, length, orig] = [v.getUint32(at + 4), v.getUint32(at + 8), v.getUint32(at + 12)];
    const data = b.subarray(offset, offset + length);
    return length < orig ? inflateSync(data) : data;
  }
}

// WOFF2 names its common tables by index: glyf 10, loca 11, fvar 47
const KNOWN: Record<number, string> = { 10: "glyf", 11: "loca", 47: "fvar" };

/** WOFF2 keeps all tables in one brotli stream, in directory order. */
function woff2(b: Uint8Array, v: DataView, name: string) {
  let at = 48, offset = 0, found: [number, number] | undefined;
  const base128 = () => {
    let value = 0, byte;
    do { byte = b[at++]; value = value * 128 + (byte & 0x7f); } while (byte & 0x80);
    return value;
  };
  for (let i = 0, n = v.getUint16(12); i < n; i++) {
    const flags = b[at++];
    const t = (flags & 0x3f) === 0x3f ? tag(b, (at += 4) - 4) : KNOWN[flags & 0x3f];
    let length = base128();
    // glyf and loca are transformed unless version 3, every other table unless version 0
    const version = flags >> 6;
    if (t === "glyf" || t === "loca" ? version !== 3 : version !== 0) length = base128();
    if (t === name) found = [offset, length];
    offset += length;
  }
  if (!found) return;
  const data = brotliDecompressSync(b.subarray(at, at + v.getUint32(20)));
  return data.subarray(found[0], found[0] + found[1]);
}
