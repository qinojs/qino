# Swiss law for fin

What Swiss law says about invoices, reminders, VAT and records, as far as fin is concerned.
Researched 2026-10 from the statutes and the federal tax administration (ESTV); not confirmed by
a fiduciary. **Verified** = read in the statute or an ESTV text;
**secondary** = from guides, not checked against the source.

## Invoices (MWSTG 26, 27)

- **Content** (MWSTG 26 II, verified): supplier and recipient with name and place, the supplier's
  VAT number, date or period of the service where it differs from the invoice date, kind and
  extent of the service, the price, the rate and the tax. "As a rule": missing elements may be
  shown otherwise.
- **No invoice number is required** by MWSTG 26 (verified: not in the list). Numbering is good
  bookkeeping practice (OR 957a, secondary). Gapless numbers are a German expectation, not Swiss
  law; fin keeps them anyway.
- **Tax shown is owed** (MWSTG 27 II, verified), even if wrong or too high, unless the invoice is
  corrected or no tax was lost to the state.
- **Correcting an issued invoice** (MWSTG 27 IV, verified): by a document sent to the recipient
  that refers to the original and revokes it — a credit note or a cancellation document. Setting
  a sent invoice to `canceled` without such a document does not meet this.

## When VAT is owed (MWSTG 39, 40, 41)

- **Agreed consideration** (vereinbart) is the default (MWSTG 39 I, verified): tax is owed when
  invoiced (40 I a). **Received consideration** (vereinnahmt) on application (39 II): tax is
  owed when paid (40 II). The method holds for at least one tax period (39 III).
- **Advance payments** (verified): tax is owed when the money comes in, whatever the method
  (40 I c). A pro forma that is paid triggers VAT on payment.
- **Later changes** (41, verified): discounts, credit notes, bad debts are booked in the period
  the correction is booked or the reduced money comes in; earlier returns are not corrected.
- **Bad debt**: a correction of the consideration, adjusted when it is booked (MWSTG 41 I,
  verified) and declared as a reduction (figure 235, secondary) — only once the loss is final:
  the claim is "definitiv uneinbringlich" (MWST-Info 04, verified, on factoring), e.g. a
  certificate of loss; a general allowance (Delkredere) does not count (secondary). Paid after
  all, the tax is owed again (secondary).

## Foreign currency (MWSTV 45, verified)

An invoice in a foreign currency is converted to CHF for VAT at the time the tax arises, at the
ESTV's published rate — monthly average or daily rate, kept for at least a tax period. What
currency is actually paid in does not matter.

## The VAT return form (ESTV form 550, 2024 version, verified)

| Figure | What |
|---|---|
| 200 | Total consideration, incl. exempt and abroad |
| 220 | Exempt services (exports, art. 23) |
| 221 | Services abroad |
| 225 | Transfers in the notification procedure |
| 230 | Excluded services (art. 21) |
| 235 | Reductions of consideration |
| 280 | Other (land value, margin taxation …) |
| 299 | Taxable turnover |
| 302 / 303 | Normal rate 7.7 % (until 2023) / 8.1 % |
| 312 / 313 | Reduced rate 2.5 % / 2.6 % |
| 342 / 343 | Accommodation 3.7 % / 3.8 % |
| 382 / 383 | Reverse charge (Bezugsteuer) |
| 400 | Input tax on material and services |
| 405 | Input tax on investments and other operating costs |
| 410 | De-taxation (Einlageentsteuerung) |
| 415 / 420 | Corrections and reductions of input tax |

So a rate of 0 % is not one thing: exempt (220), abroad (221) and excluded (230) are different
figures, and reverse charge is a tax of its own. A tax code needs to say which. Returns are
filed online only since 2025 (secondary).

## Reminders, interest, fees (OR, MWST-Info 04)

- **Default** (OR 102, secondary): the debtor is in default after a reminder, or without one once
  an agreed due day has passed. A due date or "payable within 30 days" on the invoice is no
  agreed due day by the prevailing view — a reminder is needed (minority: AGVE 2003 Nr. 6 takes
  "net 30 days" as the reminder).
- **Default interest** 5 % a year (OR 104, secondary, consistent across sources). Not taxable:
  damages (MWSTG 18 II i; MWST-Info 04, 3.8.2.3, verified). Contractual interest (a loan, paying
  by instalments) is part of the consideration and taxable (same, verified).
- **Reminder fees**: no statutory fee; owed only if agreed (contract, terms) or proven as damage
  (secondary). **Taxable**: "Mahnspesen … gehören zum Entgelt der erbrachten Leistung"
  (MWST-Info 04, 3.8.2.3, verified) — at the rate of the service they remind of.
- **Allocation of payments** (OR 85–87, secondary): a partial payment goes to interest and costs
  first; the debtor may say which debt they pay (86); else the due one, then the oldest (87).

## Pro forma (secondary)

Not an invoice: no claim, no booking, no VAT — and so should show no tax as owed, or MWSTG 27 II
may apply. Used to ask for prepayment or for customs. Once paid it is an advance payment (above).

## Records (OR 958f, GeBüV, MWSTG 70)

- **10 years** from the end of the business year: books, vouchers, annual report (OR 958f,
  secondary but consistent). For VAT until the absolute limitation, 10 years after the tax
  period (MWSTG 70 II, 42 VI, verified); 20 years for documents on real estate (70 III).
- **Unchanged** (GeBüV 3, 9, secondary): stored so that a change would show; on changeable media
  only with technical integrity (signature, time stamp). A sent invoice's PDF must not be
  replaced.

## QR bill (secondary, bank sources)

Since 2025-11-21 (guidelines 2.3) only structured addresses (type S) in new QR bills; the
combined type K is no longer allowed. Banks still process K for a while (dates differ, up to
2026-11). fin.payment.qrbill already prints structured addresses only.

## E-invoicing (secondary)

Switzerland: no B2B obligation. Germany: must receive EN 16931 e-invoices since 2025, must send
from 2027 (turnover over EUR 800 000) and 2028 (all). Relevant for Swiss sellers to German
businesses.

## Sources

- MWSTG and MWSTV, consolidated (SwissVAT, 2023): https://www.swissvat.ch/fileadmin/user_upload/SwissVAT_Broschuere_MwStG_2023.pdf
- MWST-Info 04 (ESTV, 2025-12): https://www.swissvat.ch/fileadmin/user_upload/MI_04_05.12.2025.pdf
- VAT return form 2024: https://www.estv.admin.ch/dam/estv/de/dokumente/mwst/formulare/mwst-form-abr-muster-2024-0550-03-de.pdf.download.pdf/mwst-form-abr-muster-2024-0550-03-de.pdf
- Electronic records (KMU portal): https://www.kmu.admin.ch/kmu/de/home/praktisches-wissen/finanzielles/buchhaltung-und-revision/elektronische-aufbewahrung-der-geschaeftsbuecher.html
- QR bill addresses (ZKB): https://www.zkb.ch/media/zkb/dokumente/merkblaetter/fs-strukturierte-adressen-qr-rechnung-de.pdf
- Pro forma: https://pfeffersack.ch/lexikon/proforma-rechnung
- Reminder fees: https://magicheidi.ch/blog/mahngebuehren-schweiz
- Default and due day: https://pfeffersack.ch/lexikon/mahnwesen,
  https://law.ch/lawinfo/verzugszins/beginn-des-verzugszinslaufs/verfalltag/,
  https://files.entscheidsuche.ch/chunks/AG/OG/009/AGVE-2003-6_2003-12-31.pdf
- Bad debt: https://pfeffersack.ch/lexikon/forderungsverlust
- Figures 220/221/230: https://www.weka.ch/themen/finanzen-controlling/mehrwertsteuer/buchfuehrung-und-abrechnung/article/mwst-abrechnen-wie-fuelle-ich-die-mwst-abrechnung-korrekt-aus/
