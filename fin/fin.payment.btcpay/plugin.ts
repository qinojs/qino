export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    url: { type: "string", description: "The BTCPay Server, https://btcpay.example.com" },
    storeId: { type: "string" },
    apiKey: { type: "string", description: "Greenfield API key: btcpay.store.canviewinvoices, cancreateinvoice" },
    webhookSecret: { type: "string", description: "Secret of the store's webhook to …/payment/webhook/btcpay" },
  },
};
