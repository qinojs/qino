# social.bluesky

Configure the account's handle and an app password. `url` defaults to `https://bsky.social` and may
be changed for an account hosted by another Personal Data Server.

Publishes plain text with a deterministic record key, so a retry updates the same record instead
of creating a duplicate. Not included: OAuth, media, replies and feed sync.
