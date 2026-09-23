# messaging.telegram

Messages through a Telegram bot. Links a user account to a Telegram chat and sends to it.

## The key rule

A bot can only write to people who wrote to it first. A Telegram id or `@username` is not enough;
the `chat_id` only arrives with an incoming update. So a chat is linked, not configured — `/start`
is the equivalent of `pushManager.subscribe()` in [messaging.webpush](../messaging.webpush/README.md).

## Sending

```ts
import { send } from "@qino/qino/messaging.telegram";

await send(app, { usr: 42 }, "Your order shipped.");
await send(app, { grp: 3 }, { text: "**Deploy done** — [log](https://…)", format: "md" });
```

Recipients: `{ grp }`, `{ usr }`, `{ chat }` (one row id or many), `{ all: true }`. No
`channel` like webpush: a chat belongs to a person, not a device, so groups are enough. Selectors
add up; each chat is reached once.

A `title` becomes the first line, bold if markup is on. Text is plain by default, so `<` in user
data is safe. With a `format`, Telegram's markup subset is used; headings and lists become bold
lines and bullets. All other fields go to `sendMessage()` unchanged, so `reply_markup`,
`disable_notification`, `reply_to_message_id` etc. work. With an explicit `parse_mode` the text is
passed as is, without escaping.

Returns the number of chats reached. Chats that blocked the bot (403) or no longer exist are
deleted right away.

## Linking

1. The signed-in user asks for their link: `GET messagingTelegram/link` → `{ url, chats }`.
2. They open `https://t.me/<bot>?start=<token>` and press **Start**.
3. Telegram posts the update to the webhook; the `chat_id` lands in `telegram_chat`.

[cms.cont.my.telegram](../cms.cont.my.telegram/) offers this as a page element. The link is
never rendered into the HTML (a cached page would show an expired one), and the page polls for the
connection while the user is in Telegram, since nothing else tells it that Start was pressed.

`/stop` in the chat unlinks it, as does `DELETE messagingTelegram/link`. Linking an already linked
chat moves it — a Telegram account belongs to one person at a time.

The token is `<usr>-<exp>-<sig>`, signed with the bot token, valid 15 minutes. No table, no
cleanup. Whoever opens the link in time is bound to that account, so it is only shown to the user
themselves.

## Webhook

`POST <app>/telegram/webhook`, authenticated by the `secret_token` that Telegram sends back in
`X-Telegram-Bot-Api-Secret-Token` (the only option Telegram offers). The secret is generated on
first use and stored in settings. Register the webhook in the backend
(`cms.backend.superuser.messaging.telegram`), which knows the app's public URL.

The endpoint always answers 200; anything else makes Telegram resend the update.

**Local development needs a public HTTPS URL** (tunnel), otherwise no updates arrive and nobody can
link. Sending to linked chats works anyway.

## Settings

`messaging.telegram.botToken` — from [@BotFather](https://t.me/BotFather), the only required
setting. It is also the HMAC key for link tokens, so changing it invalidates open links (linked
chats keep working).

## Storage

`telegram_chat` — one row per linked chat. `chat_id` is unique; `usr_id` is not, since a user
may link a second Telegram account.

`error` holds the reason of the last failed delivery and is cleared on the next success. Nothing
acts on it; an admin decides whether to delete the row.

## Possible extensions

- **More bot commands than `/start` and `/stop`.** Everything else is ignored. A command table or
  `app.fire("telegram.message")` would allow answering, not just notifying.
- **Groups and channels as targets.** A Telegram group has a negative `chat_id`, which `send()`
  handles already; only the linking flow assumes a private chat.
- **Attachments.** `msg.attachments` is dropped: `sendMessage` takes no files. It would need a
  `FormData` branch in `call()`, `sendPhoto` / `sendDocument` by mime, `sendMediaGroup` for two or
  more files, and the text as `caption` — max 1024 characters instead of 4096, so longer text
  needs a separate `sendMessage`. A delivery only counts once all calls succeeded.
- **Rate limit per chat.** Batches respect the global ~30/s; the per-chat limit (~1/s) is only
  handled by honouring a 429's `retry_after` once.
- No equivalent of `pushsubscriptionchange` is needed — a chat id never changes.
