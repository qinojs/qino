# cms.cont.my.chatgpt

Place this content node on a Qino account page to let signed-in users connect, select, and
disconnect the ChatGPT account whose plan powers `ai.chatgpt`. The node does not sign users in to
Qino; that remains the responsibility of Qino's login module. The OAuth callback returns to the
page containing the node. Initial sign-in requires opening Qino at `http://127.0.0.1`.

The provider and model offer are configured in the existing AI provider admin. The node lists the
selected account's model IDs for that step.

For a page that appears automatically in the AI backend menu, install `cms.backend.ai.chatgpt`.
