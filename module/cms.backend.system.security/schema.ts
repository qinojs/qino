import { allowedPathDefaults, suspiciousPathDefaults } from "./pathlist.ts";

export const settingsSchema = {
  properties: {
    enabled:               { type: "boolean", default: false,           description: "Security active" },

    warnScore:             { type: "integer", default: 80,              description: "Warning from score" },
    blockScore:            { type: "integer", default: 300,             description: "Block from score" },
    keepDays:              { type: "integer", default: 30,              description: "Retention (days)" },

    delayStartScore:       { type: "integer", default: 60,              description: "Delay from score" },
    delayFactorMs:         { type: "integer", default: 30,              description: "Delay factor (ms/score)" },
    maxDelayMs:            { type: "integer", default: 3000,            description: "Max delay (ms)" },
    decayPerMin:           { type: "integer", default: 2,               description: "Score decay per minute" },

    userScorePercent:      { type: "integer", default: 50,              description: "Logged-in user factor (%)" },
    ipScorePercent:        { type: "integer", default: 100,             description: "IP weight (%)" },
    rangeScorePercent:     { type: "integer", default: 35,              description: "IP range weight (%)" },
    clientScorePercent:    { type: "integer", default: 70,              description: "Client weight (%)" },
    userBucketPercent:     { type: "integer", default: 45,              description: "User weight (%)" },
    pathScorePercent:      { type: "integer", default: 15,              description: "Path weight (%)" },
    pathDelayStartScore:   { type: "integer", default: 200,             description: "Path delay from score" },
    pathDelayFactorMs:     { type: "integer", default: 10,              description: "Path delay factor (ms/score)" },
    pathMaxDelayMs:        { type: "integer", default: 1200,            description: "Path max delay (ms)" },
    pathBlockSeconds:      { type: "integer", default: 900,             description: "Path block duration (s)" },
    pathBlockMax:          { type: "integer", default: 5000,            description: "Path block storage (max. entries)" },

    attackScorePercent:    { type: "integer", default: 100,             description: "Attack weight (%)" },
    attackBlockConfidence: { type: "integer", default: 92,              description: "Attack instant block from confidence" },
    loginScorePercent:     { type: "integer", default: 100,             description: "Login weight (%)" },

    requestWarnMs:         { type: "integer", default: 1500,            description: "Request warn time (ms)" },
    requestMaxMs:          { type: "integer", default: 10000,           description: "Request max time (ms)" },
    largeBody:             { type: "integer", default: 2 * 1024 * 1024, description: "Large body from (bytes)" },

    bucketCacheSeconds:    { type: "integer", default: 2,               description: "Bucket cache TTL (s)" },

    suspiciousPaths:       { type: "string",  "x-multiline": true, default: suspiciousPathDefaults.join("\n"), description: "Suspicious paths (one per line)" },
    allowedPaths:          { type: "string",  "x-multiline": true, default: allowedPathDefaults.join("\n"),    description: "Allowed paths (one per line)" },
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
          log_id: { type: "integer", "x-index": true, "x-qg-parent": "log" },
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
