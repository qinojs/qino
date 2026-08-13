import { Access, type ApiTree, NotFoundError, Output, type Params, type Ctx, s } from "@qino/qino";
import { ai } from "./mod.ts";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store",
  "X-Accel-Buffering": "no", // disable proxy buffering so chunks flush immediately
};

export const api: ApiTree = {
  sessions: {
    post: {
      description: "Start a chat session for a bot",
      input: s.object({ bot: s.string(), context: s.optional(s.record()) }),
      output: s.object({ id: s.number() }),
      access: Access.USER,
      execute: async ({ bot, context }: Params, ctx: Ctx) => ({
        id: await ai(ctx.app).createSession({ bot: String(bot), context, userId: ctx.userId }),
      }),
    },
    ":id": {
      paramSchema: s.number().describe("Session ID"),
      get: {
        description: "Load a chat session and its messages",
        access: Access.USER,
        execute: async ({ id }: Params, ctx: Ctx) => {
          const db = ctx.app.db;
          const session = await db.row`SELECT * FROM ai_session WHERE id = ${id}`;
          if (!session || Number(session.user_id) !== ctx.userId) throw new NotFoundError();
          const messages = await db.query`SELECT role, content, created_at FROM ai_message WHERE session_id = ${id} AND role IN ('user','assistant') AND content <> '' ORDER BY id`;
          return { session, messages };
        },
      },
      messages: {
        post: {
          description: "Send a message and get the assistant reply",
          input: s.object({ content: s.string(), context: s.optional(s.record()) }),
          access: Access.USER,
          execute: ({ id, content, context }: Params, ctx: Ctx) =>
            ai(ctx.app).session(Number(id)).run(String(content), ctx, context as Record<string, unknown> | undefined),
        },
      },
      stream: {
        post: {
          description: "Send a message and stream the reply (SSE)",
          input: s.object({ content: s.string(), context: s.optional(s.record()) }),
          access: Access.USER,
          execute: ({ id, content, context }: Params, ctx: Ctx): never => {
            const stream = ai(ctx.app).session(Number(id)).runStream(String(content), ctx, context as Record<string, unknown> | undefined);
            throw new Output(stream, { headers: SSE_HEADERS });
          },
        },
      },
    },
  },
  "image-generations": {
    post: {
      description: "Generate images from a prompt (OpenAI-compatible passthrough)",
      input: s.object({ data: s.record() }),
      access: Access.USER,
      execute: ({ data }: Params, ctx: Ctx) => ai(ctx.app).images(data as Record<string, unknown>),
    },
  },
};
