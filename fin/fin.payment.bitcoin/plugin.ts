export { paymentProvider } from "./lib/provider.ts";

export const settingsSchema = {
  properties: {
    xpub: {
      type: "string",
      description: "Extended public key (zpub or xpub, native segwit) of an account used for nothing else",
    },
    esplora: {
      type: "string",
      default: "https://mempool.space/api",
      description: "Esplora API with /v1/prices — mempool.space or your own",
    },
    window: { type: "integer", default: 30, description: "Minutes the price in bitcoin holds" },
    confirmations: { type: "integer", default: 1, description: "Confirmations until a payment counts as paid" },
  },
};
