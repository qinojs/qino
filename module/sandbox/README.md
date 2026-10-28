# sandbox

Runs code that reaches nothing of the app: no files, no network, no environment. The code sees only
the functions it is given (capabilities); their calls come back to the app and run there.

```ts
import { Sandbox } from "@qino/qino/sandbox";

const languages = () => ({ all: ["de", "en"] });
const box = new Sandbox({ capabilities: { tools: { languages } }, timeout: 5000 });
await box.run(async (input, { tools }) => (await tools.languages()).all.length + input, 1); // 3
box.close();
```

- **`run(source, input)`** runs `source` — a function, or its source as a string (`fn.toString()`) — as
  `fn(input, capabilities)` and resolves with its result. The function must be self-contained: it sees
  its parameters, nothing of the scope it was written in.
- **Capabilities** are nested objects of functions. In the sandbox each becomes an async function of the
  same name. A failing one rejects there with its `name`, `message`, `code` and `data`.
- **Rights are the caller's business.** The sandbox only runs code and passes calls on. Which tools, as
  which user, is decided by what goes into `capabilities` (e.g. `toTools` with an allowlist, run with
  `runAs`).
- **One engine per sandbox**, started with the first run, shared by parallel runs. A timeout, a failure
  of the engine, or `close()` ends it together with every run in it; the next run starts a new one.
  `using box = new Sandbox(…)` closes it at the end of the scope.

## Engines

`new Sandbox({ engine })` — the code runs the same in both; `Promise`, `async`/`await` and
`setTimeout` are there.

| | `quickjs` (default) | `worker` |
|---|---|---|
| Runtime | Deno, Node, Bun | Deno, with `--unstable-worker-options` |
| Isolation | an engine of its own in WASM, memory capped (64 MB) | a V8 worker without permissions |
| Values | JSON, keeping `undefined` (a `Date` arrives as its string) | structured clone |
| Speed | interpreter: fine for logic and tool calls, slow for heavy computing | V8 with JIT |
| Start | ~4 ms (the WASM once per process, ~20–80 ms) | ~14 ms, ~8 MB each |

An engine is a function `({ keys, call, timeout }) => { run, close }` — another one plugs in the same
way.

### `worker` needs `--unstable-worker-options`

Only with it can a Deno worker get its own permissions — without it, it inherits all of the app's.
Worse, asking for them without the flag makes Deno exit the whole process. So the engine checks first,
as Deno decides: the flag, else the config Deno uses (`--config <file>`, none with `--no-config`, else
`"unstable": ["worker-options"]` in a `deno.json` from the working directory up). Without it, `run`
fails; code never runs unrestricted.
