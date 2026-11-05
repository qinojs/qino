# Newsletter signup

Each node signs up to one `grp` of type `newsletter`: the one in its `grp_id`, or, without one, the only
newsletter group there is. Only groups of that type can be joined, so a node can never add anyone to
another group. Multiple newsletters use separate groups and separate newsletter nodes. The node's own
title is its heading, edited on the page; left empty, there is none.

The visitor submits only an email address. A single-use confirmation ticket binds the normalized
address, node and group. Opening the link does not redeem it; the visitor must press Confirm.
Membership is written to `usr_grp` only after confirmation, with the node's group checked again.
Existing verified contacts keep their user account. A new address gets an
inactive, passwordless user with one verified `usr_contact`; it cannot sign in through this form.
Sending a newsletter with `messaging.email.send(app, { grp: id }, ...)` then uses the existing
group-specific unsubscribe link. Changing the node's group invalidates its outstanding tickets.

No group or user IDs are accepted from a public form. The same generic acknowledgement is shown
for existing subscribers and new addresses. At most three confirmation emails per address, group
and form can be requested in an hour; suspicious requests are also reported to the security module.
The public form is unavailable until `messaging.email.address` is configured. Confirmation links use the app's canonical URL.
