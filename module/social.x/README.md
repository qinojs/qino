# social.x

Configure `social.x.accessToken` with an OAuth user access token carrying `tweet.read`, `users.read`
and `tweet.write`. The authenticated X account is the module's single target.

The module publishes plain text and synchronizes the latest own posts and mentions. It intentionally
does not implement OAuth authorization, token refresh, media, editing or deletion yet. X API access
and usage charges are managed in the X Developer Console.
