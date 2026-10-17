export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    iban: {
      type: "string",
      description: "The account paid into: a QR-IBAN takes QR references, a normal IBAN creditor references (RF…)",
    },
  },
};
