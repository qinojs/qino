import { createConnection } from "node:net";

/** Ask the root helper (host/helper.ts) on its socket: one JSON line out, one back. */
export function call(path: string, verb: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const sock = createConnection(path, () => sock.write(JSON.stringify({ verb }) + "\n"));
    sock.setTimeout(60_000, () => sock.destroy(new Error("hosting helper timed out")));
    sock.on("data", (chunk) => buf += chunk);
    sock.on("error", reject);
    sock.on("end", () => {
      try {
        const res = JSON.parse(buf);
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      } catch (e) {
        reject(e);
      }
    });
  });
}
