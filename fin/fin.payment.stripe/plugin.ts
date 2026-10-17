export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    secretKey: { type: "string", description: "sk_live_… or sk_test_… — the key decides live or test" },
    webhookSecret: { type: "string", description: "whsec_… of the endpoint …/payment/webhook/stripe" },
  },
};
