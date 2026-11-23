import { test } from "node:test";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { assertEquals } from "@qino/qino/tests";

import { fontAxes } from "../lib/fontAxes.ts";
import { AXES, fvar, variableTtf } from "./font.ts";

test("fontAxes: TrueType", () => {
  assertEquals(fontAxes(variableTtf()), AXES);
});

test("fontAxes: WOFF, compressed table", () => {
  const table = fvar(), data = deflateSync(table), b = new Uint8Array(44 + 20 + data.length), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("wOFF")); v.setUint16(12, 1);
  b.set(new TextEncoder().encode("fvar"), 44); v.setUint32(48, 64); v.setUint32(52, data.length); v.setUint32(56, table.length);
  b.set(data, 64);
  assertEquals(fontAxes(b), AXES);
});

test("fontAxes: WOFF2, a table behind another one", () => {
  const table = fvar(), head = new Uint8Array(5); // a known table (cmap, index 0) of 5 bytes, then fvar (47)
  const data = brotliCompressSync(new Uint8Array([...head, ...table]));
  const dir = [0, 5, 47, table.length];
  const b = new Uint8Array(48 + dir.length + data.length), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("wOF2")); v.setUint16(12, 2); v.setUint32(20, data.length);
  b.set(dir, 48); b.set(data, 48 + dir.length);
  assertEquals(fontAxes(b), AXES);
});

test("fontAxes: a static font has none", () => {
  const b = new Uint8Array(12), v = new DataView(b.buffer);
  v.setUint32(0, 0x10000);
  assertEquals(fontAxes(b), {});
});
