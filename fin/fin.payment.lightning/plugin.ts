export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    url: { type: "string", description: "The LNbits instance, https://lnbits.example.com" },
    invoiceKey: { type: "string", description: "The wallet's invoice/read key — it can bill, not spend" },
    expiry: { type: "integer", default: 60, description: "Minutes an invoice stays payable" },
  },
};
