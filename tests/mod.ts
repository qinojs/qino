export * from "../module/core/tests/deps.ts";
export { fakeAi } from "../module/ai/tests/deps.ts";
export { fakeCms, render as cmsRender } from "../module/cms/tests/deps.ts";
export { fakeMail } from "../module/mail/tests/deps.ts";
export { dbSchema as messagingDbSchema, messagingPlaceholders } from "../module/messaging/tests/deps.ts";
export { messagingChannel as emailMessagingChannel } from "../module/messaging.email/tests/deps.ts";
export { dbSchema as telegramDbSchema, messagingChannel as telegramMessagingChannel } from "../module/messaging.telegram/tests/deps.ts";
export { dbSchema as scoreDbSchema } from "../module/score/tests/deps.ts";
export { dbSchema as ticketDbSchema } from "../module/ticket/tests/deps.ts";
