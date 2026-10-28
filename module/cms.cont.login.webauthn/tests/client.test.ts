import { runInNewContext } from "node:vm";
import { assertEquals, fakeT } from "@qino/qino/tests";

Deno.test("passkey form submits without navigating away and restores its button on failure", async () => {
  const source = await Deno.readTextFile(new URL("../pub/main.js", import.meta.url));
  let submit: (event: { preventDefault(): void }) => Promise<void>;
  let prevented = false;
  const button = { disabled: false, textContent: "Sign in with passkey" };
  const message = { value: "" };
  const root = {
    dataset: {},
    querySelector: (selector: string) => selector === ".-msg" ? message : button,
    addEventListener: (name: string, handler: typeof submit) => {
      assertEquals(name, "submit");
      submit = handler;
    },
  };
  runInNewContext(source.replace(/^import .*;\n/gm, ""), {
    cms: { initNode: (_name: string, init: (root: unknown) => void) => init(root) },
    t: fakeT,
    console,
    WebAuthn: class {
      login() {
        assertEquals(button.disabled, true);
        throw new Error("Cancelled");
      }
    },
  });
  await submit!({ preventDefault() { prevented = true; } });
  assertEquals(prevented, true);
  assertEquals(message.value, "Cancelled");
  assertEquals(button.disabled, false);
  assertEquals(button.textContent, "Sign in with passkey");
});
