# fin.invoice.reminder

Reminders for issued invoices that are overdue: a payment reminder first, then the reminders,
each so many days after the due date (`fin.invoice.reminder.days`, default `10, 20, 30`). A daily
job sends what is due; `remind(app, id)` sends the next one at once. Each goes to the invoice's
user by mail (`messaging.email`) with the invoice's PDF, in its language, and asks for what is
still open. The invoice counts them (`reminder`) and keeps the day of the last (`reminded`).

## Decisions that may change

- **Only invoices with a user** are reminded: a party without one has no address to mail to.
- **No fees, no interest.** A reminder fee or default interest would be a new invoice line or
  invoice; not built.
- **Stops after the last level.** What follows — collection — is by hand.
