import { assertEquals, assertRejects } from "./deps.ts";
import { readUploadFile } from "../lib/fileStream.ts";

Deno.test("fileStream: readUploadFile stores upload metadata and md5", async () => {
  const file = new File([new Uint8Array([1, 2, 3]), "abc"], "upload.txt", { type: "text/plain" });
  const uploaded = await readUploadFile(file, { maxSize: 10 });
  try {
    assertEquals(uploaded.name, "upload.txt");
    assertEquals(uploaded.type, "text/plain");
    assertEquals(uploaded.size, 6);
    assertEquals(uploaded.md5, "9dd9947b1036216969f6d340cae9aa4e");
    assertEquals(await Deno.readFile(uploaded.tmpPath), new Uint8Array([1, 2, 3, 97, 98, 99]));
  } finally {
    await Deno.remove(uploaded.tmpPath).catch(() => {});
  }
});

Deno.test("fileStream: readUploadFile rejects streams over maxSize", async () => {
  const file = new File(["too large"], "large.txt", { type: "text/plain" });
  await assertRejects(() => readUploadFile(file, { maxSize: 3 }), Error, "Stream too large");
});

Deno.test("fileStream: readUploadFile accepts empty and exact maxSize files", async () => {
  const empty = await readUploadFile(new File([""], "empty.txt", { type: "text/plain" }), { maxSize: 1 });
  const exact = await readUploadFile(new File(["123"], "exact.txt", { type: "text/plain" }), { maxSize: 3 });
  try {
    assertEquals(empty.size, 0);
    assertEquals(empty.md5, "d41d8cd98f00b204e9800998ecf8427e");
    assertEquals(exact.size, 3);
    assertEquals(exact.md5, "202cb962ac59075b964b07152d234b70");
  } finally {
    await Deno.remove(empty.tmpPath).catch(() => {});
    await Deno.remove(exact.tmpPath).catch(() => {});
  }
});
