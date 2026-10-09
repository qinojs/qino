# cms.backend.ai1.chatgpt

Install this module through Qino's Modules page. Its `install()` hook adds **ChatGPT plan** to the
AI backend menu. Open that page to connect, select, or disconnect the signed-in Qino user's
ChatGPT account. The OAuth callback returns to the backend page.

Qino itself still uses its own login. The ChatGPT connection authorizes eligible `ai1` text calls
against that user's plan. Open the local Qino site through `http://127.0.0.1` before connecting.
