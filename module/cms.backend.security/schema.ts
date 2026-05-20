import { allowedPathDefaults, suspiciousPathDefaults } from "./pathlist.ts";

export const settingsSchema = {
  properties: {
    enabled:               { type: "boolean", default: true,            description: "Security aktiv" },

    warnScore:             { type: "integer", default: 40,              description: "Warnung ab Score" },
    blockScore:            { type: "integer", default: 120,             description: "Block ab Score" },
    keepDays:              { type: "integer", default: 30,              description: "Aufbewahrung (Tage)" },

    delayStartScore:       { type: "integer", default: 20,              description: "Delay ab Score" },
    delayFactorMs:         { type: "integer", default: 60,              description: "Delay Faktor (ms/score)" },
    maxDelayMs:            { type: "integer", default: 6000,            description: "Max Delay (ms)" },
    decayPerMin:           { type: "integer", default: 2,               description: "Score-Abbau pro Minute" },

    userScorePercent:      { type: "integer", default: 50,              description: "Eingeloggter User Faktor (%)" },
    ipScorePercent:        { type: "integer", default: 100,             description: "IP-Gewicht (%)" },
    rangeScorePercent:     { type: "integer", default: 35,              description: "IP-Range-Gewicht (%)" },
    clientScorePercent:    { type: "integer", default: 70,              description: "Client-Gewicht (%)" },
    userBucketPercent:     { type: "integer", default: 45,              description: "User-Gewicht (%)" },
    pathScorePercent:      { type: "integer", default: 15,              description: "Pfad-Gewicht (%)" },
    pathDelayStartScore:   { type: "integer", default: 200,             description: "Pfad Delay ab Score" },
    pathDelayFactorMs:     { type: "integer", default: 10,              description: "Pfad Delay Faktor (ms/score)" },
    pathMaxDelayMs:        { type: "integer", default: 1200,            description: "Pfad Max Delay (ms)" },
    pathBlockSeconds:      { type: "integer", default: 900,             description: "Pfadblock Dauer (s)" },
    pathBlockMax:          { type: "integer", default: 5000,            description: "Pfadblock Speicher (max. Einträge)" },

    attackScorePercent:    { type: "integer", default: 100,             description: "Attack-Gewicht (%)" },
    attackBlockConfidence: { type: "integer", default: 92,              description: "Attack Sofortblock ab Confidence" },
    loginScorePercent:     { type: "integer", default: 100,             description: "Login-Gewicht (%)" },

    requestWarnMs:         { type: "integer", default: 1500,            description: "Request Warnzeit (ms)" },
    requestMaxMs:          { type: "integer", default: 10000,           description: "Request Maxzeit (ms)" },
    slowMs:                { type: "integer", default: 1500,            description: "Legacy Slowzeit (ms)" },
    largeBody:             { type: "integer", default: 2 * 1024 * 1024, description: "Großer Body ab (bytes)" },

    bucketCacheSeconds:    { type: "integer", default: 2,               description: "Bucket-Cache TTL (s)" },

    suspiciousPaths:       { type: "string",  "x-multiline": true, default: suspiciousPathDefaults.join("\n"), description: "Verdächtige Pfade (eine pro Zeile)" },
    allowedPaths:          { type: "string",  "x-multiline": true, default: allowedPathDefaults.join("\n"),    description: "Erlaubte Pfade (eine pro Zeile)" },
  },
};

export type SecuritySettings = Record<string, number> & {
  enabled: boolean;
  suspiciousPaths: string;
  allowedPaths: string;
};

export const dbSchema = {
  properties: {
    m_security_event: {
      additionalProperties: {
        properties: {
          id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
          log_id: { type: "integer", "x-index": true, "x-qg-parent": "log", "x-qg-on-parent-delete": "setnull" },
          time: { type: "integer", "x-index": true },
          prio: { type: "string", maxLength: 16, "x-index": true },
          kind: { type: "string", maxLength: 32, "x-index": true },
          scope: { type: "string", maxLength: 16, "x-index": true },
          ident: { type: "string", maxLength: 191, "x-index": true },
          reason: { type: "string", maxLength: 191, "x-index": true },
          state: { type: "string", maxLength: 16, "x-index": true },
          confidence: { type: "integer", "x-index": true },
          severity: { type: "integer", "x-index": true },
          score: { type: "integer" },
          delay_ms: { type: "integer" },
          blocked: { type: "boolean", "x-index": true },
          ip: { type: "string", maxLength: 64, "x-index": true },
          ip_range: { type: "string", maxLength: 64, "x-index": true },
          client_id: { type: "integer", "x-index": true },
          sess_id: { type: "integer", "x-index": true },
          usr_id: { type: "integer", "x-index": true },
          method: { type: "string", maxLength: 8 },
          path: { type: "string", maxLength: 191, "x-index": true },
          status: { type: "integer", "x-index": true },
          duration_ms: { type: "integer", "x-index": true },
          bytes_in: { type: "integer" },
          bytes_out: { type: "integer" },
          ua: { type: "string" },
          data: { type: "string" },
        },
        required: ["id", "time", "prio", "kind", "scope", "ident", "reason", "state", "confidence", "severity", "score", "delay_ms", "blocked", "ip", "ip_range", "method", "path", "status", "duration_ms", "bytes_in", "bytes_out", "ua", "data"],
      },
    },
    m_security_bucket: {
      additionalProperties: {
        properties: {
          id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
          scope: { type: "string", maxLength: 16, "x-index": true },
          ident: { type: "string", maxLength: 191, "x-index": true },
          score: { type: "integer", "x-index": true },
          count: { type: "integer", "x-index": true },
          blocked: { type: "boolean", "x-index": true },
          first_seen: { type: "integer", "x-index": true },
          last_seen: { type: "integer", "x-index": true },
          reason: { type: "string", maxLength: 191, "x-index": true },
          sample_path: { type: "string", maxLength: 191 },
          data: { type: "string" },
        },
        required: ["id", "scope", "ident", "score", "count", "blocked", "first_seen", "last_seen", "reason", "sample_path", "data"],
      },
    },
  },
};
