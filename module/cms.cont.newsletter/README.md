# Newsletter signup

Each node selects one `grp` ID in `grp_id` and its exact name in `group_label`. A group is eligible only if its name matches, its `grp.type` is
`newsletter` and its ID appears in the app setting `cms.cont.newsletter.allowed_groups` (comma-separated
IDs). The app setting defaults to empty, so subscriptions are disabled until a site owner explicitly
allows groups. Multiple newsletters use separate groups and separate newsletter nodes.

The visitor submits only an email address. A single-use confirmation ticket binds the normalized
address, node and group. Opening the link does not redeem it; the visitor must press Confirm.
Membership is written to `usr_grp` only after confirmation, with the group's eligibility and node
binding checked again. Existing verified contacts keep their user account. A new address gets an
inactive, passwordless user with one verified `usr_contact`; it cannot sign in through this form.
Sending a newsletter with `messaging.email.send(app, { grp: id }, ...)` then uses the existing
group-specific unsubscribe link. Changing the node's group invalidates its outstanding tickets.

No group or user IDs are accepted from a public form. The same generic acknowledgement is shown
for existing subscribers and new addresses. At most three confirmation emails per address, group
and form can be requested in an hour; suspicious requests are also reported to the security module.
The public form is unavailable until `messaging.email.address` is configured. Confirmation links use the app's canonical URL.
