// A minimal sfnt with only an fvar table: wght 100–900, wdth 62–125
export const fvar = (): Uint8Array => {
  const b = new Uint8Array(16 + 2 * 20), v = new DataView(b.buffer);
  v.setUint16(0, 1); v.setUint16(4, 16); v.setUint16(8, 2); v.setUint16(10, 20);
  [["wght", 100, 400, 900], ["wdth", 62, 100, 125]].forEach(([tag, min, def, max], i) => {
    b.set(new TextEncoder().encode(tag as string), 16 + i * 20);
    [min, def, max].forEach((x, j) => v.setInt32(16 + i * 20 + 4 + j * 4, (x as number) * 65536));
  });
  return b;
};
export const AXES: Record<string, [number, number]> = { wght: [100, 900], wdth: [62, 125] };

/** A TrueType file with only that table. */
export const variableTtf = (): Uint8Array => {
  const table = fvar(), b = new Uint8Array(12 + 16 + table.length), v = new DataView(b.buffer);
  v.setUint32(0, 0x10000); v.setUint16(4, 1);
  b.set(new TextEncoder().encode("fvar"), 12); v.setUint32(20, 28); v.setUint32(24, table.length);
  b.set(table, 28);
  return b;
};
