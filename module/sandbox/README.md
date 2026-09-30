# sandbox

Runs code in a Worker without any permissions: no files, no network, no environment. The code sees
only the functions it is given (capabilities); their calls come back to the app and run there.

```ts
import { Sandbox } from "@qino/qino/sandbox";

const box = new Sandbox({ capabilities: { tools: { get_core_languages: () => ({ all: ["de", "en"] }) } }, timeout: 5000 });
await box.run(async (input, { tools }) => (await tools.get_core_languages()).all.length + input, 1); // 3
box.close();
```

- **`run(source, input)`** runs `source` — a function, or its source as a string (`fn.toString()`) — as
  `fn(input, capabilities)` and resolves with its result. The function must be self-contained: it sees
  its parameters, nothing of the scope it was written in.
- **Capabilities** are nested objects of functions. In the worker each becomes an async function of the
  same name; arguments and results are copied (structured clone). A failing one rejects there with its
  `name`, `message`, `code` and `data`.
- **Rights are the caller's business.** The sandbox only runs code and passes calls on. Which tools, as
  which user, is decided by what goes into `capabilities` (e.g. `toTools` with an allowlist, run with
  `runAs`).
- **One worker per sandbox**, started with the first run, shared by parallel runs. A timeout, an error
  of the worker itself, or `close()` ends it together with every run in it; the next run starts a new
  one. `using box = new Sandbox(…)` closes it at the end of the scope.

## Needs `--unstable-worker-options`

Only with it can a Deno worker get its own permissions — without it, it inherits all of the app's.
Worse, asking for them without the flag makes Deno exit the whole process. So the sandbox checks first,
as Deno decides: the flag, else the config Deno uses (`--config <file>`, none with `--no-config`, else
`"unstable": ["worker-options"]` in a `deno.json` from the working directory up). Without it, `run`
throws; code never runs unrestricted.

The command line is readable only with `--allow-all` (and on Linux). Without it the sandbox relies on
`deno.json` alone and can't see `--no-config` or `--config` — a site started that way with an unrelated
`deno.json` above it would still exit. Set the flag where the site starts, and it is safe.

## Cost

Measured with Deno 2.9.5: ~14 ms to start a worker, ~8 MB each, ~47 µs per call across. Cheap for
flows and for code that works through tools; not for hooks that fire many times per request or must
answer synchronously.
