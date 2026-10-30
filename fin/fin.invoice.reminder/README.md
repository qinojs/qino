# fin.invoice.reminder

Reminders for issued invoices that are overdue: a payment reminder first, then the reminders. A
reminder is a document of its own ([fin.invoice](../fin.invoice/), type `reminder`): its number,
the invoices it lists with what is open on them, its own lines — fee and default interest — and
one slip over all of it.

```ts
import { remind, remindDue } from "@qino/qino/fin.invoice.reminder";

await remindDue(app); // what the daily job does
await remind(app, [12, 15]); // these two now, on their next level
```

## When

A daily job reminds every open invoice of ours whose next level has come: so many days after its
due date (`days`, default `10, 20, 30`) and as many after its last reminder as the levels lie
apart, so a long overdue invoice does not get them all at once. A reminder with a fee left open is
reminded the same way. **One reminder per debtor and currency** — all that is due of one customer
in one letter; an invoice without a user (`usr_id`) is one of its own.

An invoice's level is how many issued reminders list it; a reminder's title follows its highest
level. Left out: invoices held (`invoice.remind` false, e.g. while disputed) and those on a reminder
still waiting as a draft.

Since the reminder is made as a document first, it counts whether it reached anyone or not: one
that could not be mailed is printed and posted by hand (`sent` stays empty).

## Fees and interest

- `fees`: per level, with tax, in the invoice's currency — `0, 20, 30`; empty: none. A fee is owed
  only where it was agreed (contract, terms). It is part of the price of what it reminds of (ESTV,
  MWST-Info 04, 3.8.2.3), so it is taxed as those lines are, shared by what is open of each.
- `interest`: default interest in percent a year (5 % by law in Switzerland, OR 104), on what is
  open, since it was due or last reminded; empty: none. Damages, not subject to tax (category `O`).

Money paid on a reminder goes to its fee and interest first, then to the oldest invoice (OR 85,
87; see [fin.invoice](../fin.invoice/README.md#paid)).

## Settings

| Setting | Default | |
|---|---|---|
| `days` | `10, 20, 30` | Days after the due date per level |
| `fees` | — | Fee per level |
| `interest` | — | Percent a year |
| `term` | `10` | Days to pay a reminder |
| `issue` | true | Issue at once; else drafts to be looked at |
| `send` | true | Mail issued ones (needs `messaging.email`) |

## Decisions that may change

- **A fee across rates is shared** by what is open per rate and category. To be confirmed by a
  fiduciary; see [LAW-CH.md](../LAW-CH.md).
- **Interest since the last reminder**, assuming that one charged it up to its day.
- **Stops after the last level.** What follows — collection — is by hand; `writeOff` gives up the
  rest.
