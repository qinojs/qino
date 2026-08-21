import type { Dict } from "./types.ts";

export const transports: Record<string, { exportName: string; keys: string[] }> = {
  smtp:     { exportName: "SmtpTransport", keys: [] },
  mailgun:  { exportName: "MailgunTransport", keys: ["apiKey", "domain", "baseUrl"] },
  resend:   { exportName: "ResendTransport", keys: ["apiKey", "baseUrl"] },
  sendgrid: { exportName: "SendGridTransport", keys: ["apiKey", "baseUrl"] },
  ses:      { exportName: "SesTransport", keys: ["region", "accessKeyId", "secretAccessKey", "sessionToken"] },
  plunk:    { exportName: "PlunkTransport", keys: ["apiKey", "baseUrl"] },
  jmap:     { exportName: "JmapTransport", keys: ["sessionUrl", "bearerToken", "accountId", "identityId"] },
  mock:     { exportName: "MockTransport", keys: [] },
};

const stringProperties = (keys: string[]): Dict =>
  Object.fromEntries(keys.map(key => [key, { type: "string" }]));

const schemas = Object.fromEntries(
  Object.entries(transports).filter(([name]) => name !== "smtp")
    .map(([name, { keys }]) => [name, { properties: stringProperties(keys) }]),
);

export const settingsSchema = {
  properties: {
    sender:     { type: "string", description: "Default From email address" },
    sendername: { type: "string", description: "Default From display name" },
    reply_to:   { type: "string", description: "Default Reply-To email address" },
    debug_to:   { type: "string", description: "Redirect all outgoing mail to this address" },
    base_url:   { type: "string", description: "Public base URL for mail tracking links" },
    _secure:    { type: "string", description: "Secret for mail tracking signatures" },
    transport: {
      properties: {
        type: { type: "string", enum: ["", ...Object.keys(transports)] },
        smtp: {
          properties: {
            host: { type: "string" },
            port: { type: "number" },
            secure: { type: "boolean" },
            username: { type: "string" },
            password: { type: "string" },
          },
        },
        ...schemas,
      },
    },
  },
};
