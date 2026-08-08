# messaging.telegram

Messages through a Telegram bot. Links a user account to a Telegram chat and delivers to it.

## The rule that shapes everything

A bot cannot write to anyone who has not written to it first. Knowing someone's Telegram id
or `@username` is not enough — the chat must exist, and the only way to learn its `chat_id`
is an incoming update. So a chat is linked, not configured, and `/start` is what a browser's
`pushManager.subscribe()` is to [messaging.web_push](../messaging.web_push/README.md).

## Sending

```ts
import { send } from "../messaging.telegram/mod.ts";

await send(app, { usr: 42 }, { text: "Your order shipped." });
await send(app, { grp: 3 }, { text: '<b>Deploy done</b> — <a href="https://…">log</a>', parse_mode: "HTML" });
```

Recipients: `{ grp }`, `{ usr }`, `{ chat }`, `{ all: true }` — no channel, because a chat
belongs to a person, not to a device; that question is what groups answer.

Everything in `msg` reaches `sendMessage()` unchanged, so `parse_mode`, `reply_markup`,
`disable_notification`, `reply_to_message_id` and friends already work. Text is plain by
default; markup needs `parse_mode` explicitly, which also means `<` in user data is safe
until you ask for HTML.

Resolves with the number of chats reached. A chat that blocked the bot (403) or no longer
exists is deleted on the way, so the table stays clean without a cleanup job.

## Linking

1. The signed-in user asks for their link: `GET messagingTelegram/link` → `{ url, chats }`.
2. They open `https://t.me/<bot>?start=<token>` and press **Start**.
3. Telegram posts the update to the webhook; the `chat_id` lands in `telegram_chat`.

`/stop` in the chat unlinks it, as does `DELETE messagingTelegram/link` for the signed-in
user. Linking a chat that is already linked re-points it — one Telegram account belongs to
one person at a time.

The token is `<usr>-<exp>-<sig>`, signed with the bot token and valid 15 minutes. Stateless
on purpose: no table, no cleanup. Its lifetime is the whole protection — whoever opens the
link within it gets bound to that account, so it is only ever shown to the user themselves.

## Webhook

`POST <app>/telegram/webhook`, authenticated by the `secret_token` Telegram echoes back in
`X-Telegram-Bot-Api-Secret-Token` — the only authentication the platform offers. The secret
is generated on first use and stored in settings. Register it from the backend
(`cms.backend.superuser.telegram`), which knows the public URL of the running app.

The endpoint always answers 200: any other status makes Telegram retry the same update.

**Local development needs a public HTTPS URL.** Without a tunnel, updates cannot arrive and
nobody can link. Sending to already linked chats works regardless.

## Settings

`messaging.telegram.botToken` — from [@BotFather](https://t.me/BotFather), the one thing
that must be configured. The token is also the HMAC key for link tokens, so replacing it
invalidates outstanding links (linked chats keep working).

## Storage

`telegram_chat` — one row per linked chat. `chat_id` is the identity and unique; `usr_id` is
indexed, not unique, since someone may connect a second Telegram account.

`error` holds why the last delivery failed and goes back to null as soon as one succeeds. It
is a state, not a log: nothing acts on it, an admin decides whether to delete the row.

## Possible extensions

- **Bot commands beyond `/start` and `/stop`.** Everything else in an update is ignored
  today. A command table or an `app.fire("telegram.message")` would open the other
  direction — answering, not just notifying.
- **Group and channel targets.** Adding the bot to a Telegram group yields a negative
  `chat_id` that `send()` would deliver to unchanged; only the linking flow assumes a
  private chat.
- **Rate limiting per chat.** Batches keep the global ~30/s ceiling; the per-chat limit of
  about one message a second is only handled reactively, by honouring the `retry_after` of a
  429 once.
- **`pushsubscriptionchange`'s counterpart** does not exist here — a chat id is stable for
  the lifetime of the account.
- **The `messaging` layer.** With this second channel, a channel-neutral `notify(user, msg)`
  with per-user preferences finally has two implementations to generalize from. The shapes
  differ where it matters: `title` + `url` versus one text with optional markup.
