# ai.chatgpt

Use an eligible ChatGPT plan for `ai` text requests. This module is for an open-source Qino
installation opened locally at `http://127.0.0.1:<port>/`. It does not use an OpenAI API key.

1. Install this module from Qino's module store, or add its `plugin.ts` to the application before
   initialization. Open `/ai-chatgpt` while signed in to Qino on `127.0.0.1`, then choose
   **Continue with ChatGPT**.
   The consent screen must grant ChatGPT plan usage. Credentials are kept in owner-only files
   under the app's `data/ai.chatgpt/` directory and belong to the Qino user who connected them.
2. The module ensures a separate `chatgpt-plan` provider at `https://api.openai.com/v1` when
   it starts. It leaves an existing matching provider unchanged and rejects a name collision with
   a different type or endpoint. The ChatGPT plan and API-key providers use the same endpoint but
   different adapters and credentials; this provider needs no API key. After sign-in, account
   selection, or opening a ChatGPT account page, the module adds the visible model IDs as enabled
   `text` and local function-tool offers for this provider. It preserves existing models and offers. Qino's AI selection
   determines which model handles a request; select a listed model to target ChatGPT plan usage.
3. The account page offers disconnect and reauthorization. A returning connection reuses its
   issued client ID. The module refreshes short-lived tokens as needed. Calls require a signed-in
   Qino user; background jobs without a user cannot spend someone's ChatGPT plan.

For a user-facing Qino page, install `cms.cont.my.chatgpt` and place its content node on an account
page. It shows the connection and model IDs and returns users to that page after authorization.
To get a menu entry without creating a CMS page, install `cms.backend.ai.chatgpt`; Qino adds
**ChatGPT plan** to the AI backend menu.

Text answers and local function tools are supported; image inputs work when the selected model
accepts them. The plan route does not currently support embeddings, image generation, speech, or
transcription. It follows the current Sign in with ChatGPT preview contract: `store: false`,
`stream: true`, and stateless Responses history. A
hosted or paid Qino service requires separate OpenAI approval. A self-hosted VM needs OAuth
completed locally and protected credentials transferred according to OpenAI's VM guide.

Sources: [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
