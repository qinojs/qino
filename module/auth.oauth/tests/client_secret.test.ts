import { assertEquals } from "@qino/qino/tests";
import { unb64url } from "@qino/qino";

import { clientSecret } from "../plugin.ts";

const json = (part: string) => JSON.parse(new TextDecoder().decode(unb64url(part)));

Deno.test("auth.oauth: without key_id the client secret is used as is", async () => {
  assertEquals(await clientSecret({ client_secret: "s3cret" }, "https://idp.test"), "s3cret");
});

Deno.test("auth.oauth: with key_id the client secret is an ES256 JWT signed by the stored key (Apple)", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toBase64();
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  const p = { client_id: "ch.example.login", client_secret: pem, key_id: "KEY123", team_id: "TEAM456" };

  const [head, body, sig] = (await clientSecret(p, "https://appleid.apple.com")).split(".");
  assertEquals(json(head), { alg: "ES256", kid: "KEY123" });
  const claims = json(body);
  assertEquals([claims.iss, claims.sub, claims.aud], ["TEAM456", "ch.example.login", "https://appleid.apple.com"]);
  assertEquals(claims.exp - claims.iat, 300);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, unb64url(sig),
    new TextEncoder().encode(head + "." + body));
  assertEquals(ok, true);
});
