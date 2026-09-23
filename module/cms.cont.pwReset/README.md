# cms.cont.pwReset

Put this element on a page for "I forgot my password". Without `?t=` in the URL it asks for the
address; with `?t=` it shows the new-password form.

The link carries a [ticket](../ticket/) of kind `auth.pwReset`, valid one hour. Opening it only
checks; the ticket is used when the form is submitted, so mail scanners can't use it up. Mail and
form show when it expires (the form as a countdown). Redeeming sets the password and ends all
sessions of the user — a reset is also how someone takes their account back.

The answer is always the same, whether the address exists or not, so the form reveals nobody. The
mail is sent without waiting, otherwise the response time would reveal it.
