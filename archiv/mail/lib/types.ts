import type { App } from "@qino/qino";
import type { MailMessage } from "./MailMessage.ts";

export type Dict = Record<string, unknown>;
export type AddressInput = string | { address?: string; email?: string; name?: string; data?: Dict; usrId?: number; mail1_track_id?: number };
export type UserInput = { id?: unknown; username?: unknown; given_name?: unknown; family_name?: unknown; get?: (key: string) => unknown | Promise<unknown> };
export type RecipientType = "to" | "cc" | "bcc";
export type Template = string | ((data: TemplateData) => string | Promise<string>);
export type Transport = { send(message: unknown, options?: unknown): Promise<unknown>; sendMany?: (messages: unknown, options?: unknown) => AsyncIterable<unknown>; close?(): Promise<void>; closeAllConnections?(): Promise<void> };
export type TransportCtor = new (options: Dict) => Transport;
export type SendReceipt = { successful?: boolean; error?: unknown; errorMessages?: string[] };
export type MailDefaults = { sender: string; sendername: string; reply_to: string; debug_to: string; base_url: string };
export type TemplateData = { app: App; mail: MailMessage; main: string; data: Dict; recipient?: Recipient };
export type Recipient = { address: string; name?: string; data?: Dict; usrId?: number; mail1_track_id?: number };
export type AttachmentInput = string | {
  path?: string;
  name?: string;
  filename?: string;
  type?: string;
  contentType?: string;
  content?: Uint8Array | Promise<Uint8Array> | Blob | File | string;
  contentId?: string;
  cid?: string;
  inline?: boolean;
};
