# cms.cont.pwReset

Put this element on a page and "I forgot my password" works. One page serves both halves: no
`?t=` in the URL asks for the address, a `?t=` shows the new-password form.

The link carries a [ticket](../ticket/) of kind `auth.pwReset`, valid an hour. Opening it only
looks — the ticket is spent when the form is submitted, so a mail scanner following the link
cannot burn it. Redeeming sets the password and deletes every session of that user: a reset is
also how someone takes their account back.

Requesting always answers the same, whether the address has an account or not — otherwise the
form is a way to find out who is registered.
