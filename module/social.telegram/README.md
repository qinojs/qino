# social.telegram

Public posts through the bot configured in `messaging.telegram`. Add the bot as an administrator to
each channel or group and list their numeric ids or `@usernames` in `social.telegram.targets`.
Register the webhook again after linking this module so Telegram includes channel and edited-post
updates in `allowed_updates`.

The module publishes plain text and consumes `channel_post`, `edited_channel_post`, group messages
and replies from the existing authenticated Telegram webhook. Telegram offers bots no account-wide
history endpoint, so posts are mirrored from the moment the webhook is active; `sync()` has no pull
side here.

Private bot chats remain exclusively in `messaging.telegram`.
