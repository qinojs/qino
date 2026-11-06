import { Buffer } from "node:buffer";
import { once } from "node:events";
import net from "node:net";

import { errMsg, publicIps } from "@qino/qino";

/**
 * A proxy on a local port that connects the browser to public addresses only, to the address it checked
 * (no second lookup that could answer otherwise). https and web sockets pass through as a tunnel, so the
 * browser keeps its own connections; plain http one request per connection.
 */
export async function proxy(): Promise<{ server: string; close: () => void }> {
  const srv = net.createServer((client) => {
    client.on("error", () => {});
    let head = Buffer.alloc(0);
    const read = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return void (head.length > 65_536 && client.destroy());
      client.off("data", read).pause(); // what follows waits for the pipe
      connect(client, head, end)
        .catch((e) => client.end(`HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\n${errMsg(e)}`));
    };
    client.on("data", read);
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  srv.unref(); // runs as long as the browser, never longer
  return { server: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`, close: () => srv.close() };
}

async function connect(client: net.Socket, head: Buffer, end: number) {
  const [method, target, version] = head.subarray(0, head.indexOf("\r\n")).toString("latin1").split(" ");
  const tunnel = method === "CONNECT";
  const url = new URL(tunnel ? `https://${target}` : target);
  if (!tunnel && url.protocol !== "http:") throw new Error(`Not proxied: ${url.protocol}`);
  const [ip] = await publicIps(url);
  const upstream = net.connect(Number(url.port) || (tunnel ? 443 : 80), ip);
  client.on("close", () => upstream.destroy()); // also while connecting
  await once(upstream, "connect");
  upstream.on("error", () => client.destroy());
  if (tunnel) client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  else {
    // to the server as its own request; the connection ends with it, the next may go elsewhere
    const lines = head.subarray(0, end).toString("latin1").split("\r\n").slice(1)
      .filter((line) => !/^(proxy-)?connection:/i.test(line));
    const request = [`${method} ${url.pathname}${url.search} ${version}`, ...lines, "connection: close", "", ""];
    upstream.write(request.join("\r\n"), "latin1");
  }
  upstream.write(head.subarray(end + 4));
  client.pipe(upstream).pipe(client);
}
