import { requestStorage } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import nodeApi from "../nodeApi.ts";

function makeNode(db: unknown, access = 2) {
  return { access: () => access, app: { db } };
}

function makeDb(opts: { emailUserId?: number }) {
  const state = { ensured: false, deleted: false };
  const db = {
    one: (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM usr WHERE username")) return opts.emailUserId ?? null;
      return null;
    },
    table: (name: string) => {
      if (name === "usr_grp") {
        return {
          ensure: () => { state.ensured = true; },
          delete: () => { state.deleted = true; },
        };
      }
      return {};
    },
    state,
  };
  return db;
}

/** Fake user whose `grps()` and `superuser` drive the membership gate. */
function makeUser(opts: { grps?: number[]; superuser?: boolean } = {}) {
  return {
    grps: () => opts.grps ?? [0],
    superuser: !!opts.superuser,
  };
}

async function run(db: ReturnType<typeof makeDb>, vars: Record<string, unknown>, user = makeUser()) {
  const node = makeNode(db);
  const ctx = await testContext({
    userId: 5,
    app: { db, t: (s: TemplateStringsArray) => s.join("") },
    set: { user },
  });
  return requestStorage.run(ctx, () => nodeApi(node as never, vars));
}

Deno.test("cms.backend.groups: member can add and remove", async () => {
  const db = makeDb({ emailUserId: 99 });
  const user = makeUser({ grps: [0, 3] });

  assertEquals(await run(db, { set_usr: 3, usr_id: 7, add: 1 }, user), 1);
  assertEquals(db.state.ensured, true);

  db.state.ensured = false;
  assertEquals(await run(db, { set_usr: 3, usr_id: 7, add: 0 }, user), 1);
  assertEquals(db.state.deleted, true);

  db.state.ensured = false;
  assertEquals(await run(db, { add_email: 3, email: "a@b.c" }, user), 1);
  assertEquals(db.state.ensured, true);
});

Deno.test("cms.backend.groups: non-member cannot manage members", async () => {
  const db = makeDb({ emailUserId: 99 });
  const user = makeUser({ grps: [0] });
  const err = { error: "You are not a member of this group and cannot manage its members." };

  assertEquals(await run(db, { set_usr: 3, usr_id: 7, add: 1 }, user), err);
  assertEquals(db.state.ensured, false);

  assertEquals(await run(db, { set_usr: 3, usr_id: 7, add: 0 }, user), err);
  assertEquals(db.state.deleted, false);

  assertEquals(await run(db, { add_email: 3, email: "a@b.c" }, user), err);
  assertEquals(db.state.ensured, false);
});

Deno.test("cms.backend.groups: add_email with unknown email returns error", async () => {
  const db = makeDb({}); // no emailUserId → lookup misses
  const user = makeUser({ grps: [0, 3] });

  assertEquals(
    await run(db, { add_email: 3, email: "nobody@x.y" }, user),
    { error: "No user found with this email address." },
  );
  assertEquals(db.state.ensured, false);
});

Deno.test("cms.backend.groups: superuser bypasses membership gate", async () => {
  const db = makeDb({ emailUserId: 99 });
  const user = makeUser({ grps: [0], superuser: true });

  assertEquals(await run(db, { set_usr: 3, usr_id: 7, add: 1 }, user), 1);
  assertEquals(db.state.ensured, true);
});
