export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    clientId: { type: "string", description: "REST app client id (developer.paypal.com → Apps & Credentials)" },
    secret: { type: "string" },
    live: { type: "boolean", description: "Live payments; the sandbox otherwise" },
  },
};
