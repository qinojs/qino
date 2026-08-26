# social.bluesky

Configure the account's handle and an app password. `url` defaults to `https://bsky.social` and may
be changed for an account hosted by another Personal Data Server.

The module publishes plain text with a deterministic record key, so a retry updates the same record
instead of creating a duplicate. OAuth, media, replies and feed synchronization are deliberately not
part of the minimal version.
