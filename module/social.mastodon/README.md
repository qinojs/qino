# social.mastodon

Configure `social.mastodon.url` with the instance's HTTPS origin and `accessToken` with a user token
that may read the account/statuses/notifications and write statuses. The connected account is the
module's single target.

Publishing uses Mastodon's idempotency key. Every sync reads the latest 40 own statuses and mention
notifications; the shared journal makes overlapping runs harmless. This deliberately small window
starts mirroring current activity without importing the account's full history.

Mastodon returns status bodies as HTML. The adapter stores their readable plain-text form.
