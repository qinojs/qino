import { sync } from "./mod.ts";

import type { Jobs } from "@qino/qino/cron";

export const settingsSchema = {
  properties: {
    url: { type: "string", description: "The bank's EBICS 3.0 endpoint (HTTPS)" },
    hostId: { type: "string" },
    partnerId: { type: "string" },
    userId: { type: "string" },
    passphraseEnv: { type: "string", description: "Name of the environment variable holding the keyring passphrase" },
    bankX002: { type: "string", description: "The bank's authentication key hash, from a channel other than HPB" },
    bankE002: { type: "string", description: "The bank's encryption key hash, from a channel other than HPB" },
    btfService: { type: "string", description: "BTF service name of the camt.054 download, e.g. REP" },
    btfScope: { type: "string", description: "BTF scope, e.g. CH" },
    btfOption: { type: "string", description: "BTF service option, if the connection uses one" },
    btfVersion: { type: "string", description: "camt.054 message version, e.g. 08" },
  },
};

export const cron = {
  download: {
    every: "hour",
    timeout: 10 * 60,
    run: (app, { signal }) => sync(app, signal),
  },
} satisfies Jobs;
