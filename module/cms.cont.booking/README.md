# Appointment booking

Each `cms.cont.booking` content node owns its offers and bookings. Offers use `cms.event`;
each offer is a concrete event block, without a recurrence rule.
Every new instance starts empty. Add appointments in its CMS settings panel.

With `duration: 0`, an offer is booked as a whole. A positive duration (minutes) splits offers
into consecutive slots. For example, a concrete
09:00–11:00 window with `duration: 30` provides four slots. Further days use further blocks.
The instance's `time_zone` controls date selection and display; local input is converted to explicit instants when an offer is saved. `horizon_days` limits how far ahead visitors can book (default 60).

Visitors choose a slot and supply name and email. Booking and cancellation work without JS,
through the CMS's CSRF-protected POST forms. No email or payment is triggered. Guest bookings
can be managed from the same server-side session; signed-in users can manage their own bookings
across sessions. Editors can view and cancel all bookings of their node. Email delivery and
cancellation links for guests on another device are not implemented.

Availability is always recomputed on the server. A transaction locks the instance's own calendar row and
checks overlapping bookings before inserting; simultaneous requests cannot both reserve the
same time. Offers of different instances never block one another. Cancellation frees the slot.
Editing an offer does not move existing bookings. Offers with any booking history cannot be
deleted; their existing bookings keep their recorded time.

The calendar row is created atomically on the first write. MySQL booking tables must use InnoDB;
the original CMS `page` table may still use MyISAM without weakening booking serialization.

The owning node must be readable for availability, booking details and every API action.
Only editors can change offers; knowing an event or booking ID grants no access. Public slot
responses contain no customer data. The calendar source shows bookings only to the node's
editors and their signed-in owner, still subject to node visibility. The event source may also
show the readable offers themselves; source selection controls their display independently.
