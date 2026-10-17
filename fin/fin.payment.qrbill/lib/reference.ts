/**
 * References a bank carries back on the statement, so a payment finds itself again.
 *
 * - QR reference (QRR): 27 digits, the last a recursive mod-10 check — only with a QR-IBAN.
 * - Creditor reference (SCOR, ISO 11649): `RF`, two check digits, up to 21 letters or digits —
 *   with a normal IBAN, and understood across Europe.
 */

const MOD10 = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** A QR reference for a number, or for up to 26 digits. */
export function qrr(n: number | string): string {
  const digits = String(n).padStart(26, "0");
  if (!/^\d{26}$/.test(digits)) throw new Error("fin.payment.qrbill: a QR reference takes up to 26 digits");
  let carry = 0;
  for (const d of digits) carry = MOD10[(carry + Number(d)) % 10];
  return digits + (10 - carry) % 10;
}

/** A creditor reference for a number. */
export function scor(n: number): string {
  const ref = String(n);
  // letters count as 10 to 35; the check is computed over ref + "RF00"
  const numeric = (ref + "RF00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const d of numeric) mod = (mod * 10 + Number(d)) % 97;
  return `RF${String(98 - mod).padStart(2, "0")}${ref}`;
}

/** A QR-IBAN has an institution id from 30000 to 31999; it takes QR references only. */
export function isQrIban(iban: string): boolean {
  const id = Number(iban.replace(/\s+/g, "").slice(4, 9));
  return id >= 30000 && id <= 31999;
}
