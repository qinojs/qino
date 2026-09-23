# social.mastodon

Configure `social.mastodon.url` with the instance's HTTPS origin and `accessToken` with a user token
that may read the account/statuses/notifications and write statuses. The connected account is the
module's single target.

Publishing uses Mastodon's idempotency key. Each sync reads the latest 40 own statuses and
mentions; overlapping runs are harmless. The full history is not imported.

Mastodon returns HTML; the module stores it as plain text.
