# cms.backend.newsletter

Newsletters in the backend: lists, subscribers, issues and what came of them. It only adds the
surface — sending, templates, tracking, unsubscribing and bounces are
[messaging](../messaging/) and [messaging.email](../messaging.email/).

Installing it brings what a first newsletter needs: a list and the email template `newsletter`
(mail html filled by [identity](../identity/): logo, name, colour, address, unsubscribe link). Both
are only created if missing. Until the first newsletter, the overview lists what is left to do.
Health checks flag a template without `{{unsubscribe}}` or sender address, and scheduled
newsletters that are overdue.

- **List** — a `grp` of type `newsletter`. [cms.cont.newsletter](../cms.cont.newsletter/) is the
  signup form for one.
- **Issue** — a mail to a list, shown as *Newsletter* in the backend. A *draft* is the message without deliveries; sending
  (`release()`) makes them for whoever is on the list then. Scheduled issues wait in the outbox
  and can be made a draft again until the first one goes out.
- **Subscriber** — a user in the group; their main email address receives it.

The editor is `<u2-rte>`, so issues are html. The preview shows the issue in its template with
fallback values; a test goes to one address and has no unsubscribe link, since it is not sent to the
list.

**Adding addresses** creates inactive users without password, for addresses the site does not know.
Known ones are left out: someone who unsubscribed was removed from the group and must not be put
back by an import. Add those by hand in the groups backend.

**Bounced** subscribers are those whose address carries an error (`usr_contact.error`, set by a
bounce or a refused delivery). A send to the list skips them; a click or open in a later mail, or a
confirmed signup, clears the mark. They are shown, and removed from the list with one button.
