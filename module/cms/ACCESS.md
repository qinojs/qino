# CMS access system

One scale everywhere: **0 none · 1 read · 2 edit · 3 admin** (`lib/access.ts`).
`usr.superuser` is a **flag**, not a level — a superuser always acts as 3 and
bypasses every rule below.

Two independent axes, combined with `min`:

```
effective(user, node) = min( node axis, module axis of the node's own module )
```

- The **node axis** lives in the `cms` core and is the only access control
  without extra modules.
- The **module axis** is entirely optional (`cms.accessRules` module). Without
  it, nothing below the "Module axis" section exists.

A guiding principle: **access = usage**. Whoever reaches a node may use all of
its module's functions — there are no extra superuser checks inside module code.
Backend pages are ordinary CMS pages, gated by the same system.


## Node axis (core)

Per node, additive — the *highest* grant wins:

```
node axis = max( node level, page_access_usr, page_access_grp )
```

| Source | Values | Meaning |
| --- | --- | --- |
| `page.access` (node level) | `0` | private |
| | `1` | public (guests read) |
| | `null` | inherited from the parent node |
| `page_access_usr` | 0–3 per (page, user) | personal grant |
| `page_access_grp` | 0–3 per (page, group) | group grant; highest group wins |

Inheritance: a node with `access = null` takes its parent's node-axis value
(**before** any module-axis capping — see invariants) and combines it with its
own `page_access_usr` grants.

Computed in `Node.access()` / `#calcUsrAccess` (`lib/Node.ts`), cached per
request in `cmsCtx(ctx).accessCache`. The result is fired through the
`node:access` event, where other modules may adjust it.

Backend UI: *cms.backend.cms.tree.access* (per-page group matrix),
*cms.backend.groups* (groups & members).


## Module axis (optional module `cms.accessRules`)

Answers "what may this user do with content of module X?" — independent of any
node. Three sources:

| Source | Values | Meaning |
| --- | --- | --- |
| `module.cms_access` ("standard") | `null` | no rule — the axis does not exist for this module |
| | `0` deny | module off for **everyone** incl. guests; only explicit group overrides (and superusers) see it |
| | `1–3` | default level for everyone |
| `grp.cms_access` ("CAP") | `null` | group is irrelevant for the module axis |
| | `1–3` | hard ceiling for everything this group can get on the axis |
| `cms_module_access_grp` ("override") | 0–3 per (module, group) | replaces the standard for this group — but never exceeds the group's CAP |

```
per group   = min( CAP, override ?? standard ?? 3 )
module axis = max( standard ?? -, best group )        // most permissive group wins
```

Semantics of the levels *on this axis*:

- **1 read** — see rendered content of the module.
- **2 edit** — edit existing content of the module. Rendering-wise identical to 3.
- **3 insertable (admin)** — additionally: the module appears in the add-picker
  and may be assigned to nodes (`contents.post`, `module.put`). This is an
  *editorial* gate, not a security gate — assigning a module can never escalate
  rights (the axis only caps). Typical use: the superuser places an exotic or
  code-level module once (`standard = 2`), editors keep editing its texts but
  cannot add new instances.

Backend UI: *cms.backend.cms.accessRules* — one matrix editing all three
sources (CAP row, standard column, override cells).


## Invariants

1. **A logged-in user never sees less than a guest.** The module axis only caps
   the edit surplus: the result is lifted back to the node's guest baseline
   (`isPublic ? 1 : 0`). Exception: `standard = 0` — there the guest baseline is
   itself 0, so the module vanishes for everyone consistently.
2. **Module caps do not inherit.** A node inherits its parent's *raw* node-axis
   value (`Node.#rawAccess`), never the module-capped result — the rules of a
   container/layout module apply to that node only, not to its children.
3. **An override never exceeds the group's CAP** (`min`), and a CAP can never
   push anyone *above* their node-axis rights (the axis only lowers).
4. **Superuser bypasses the module axis entirely** and always counts as 3.


## Events (the seams between core and cms.accessRules)

- `node:access` `{ node, user, access }` — fired by `Node.access()` with the raw
  node-axis value; handlers adjust `access` for **this node only**.
  `cms.accessRules` caps it by the module axis here.
- `module:access` `{ module, user, access }` — fired by consumers that need the
  module axis without a node (add-picker `add.ts`, `requireModuleAdmin` in
  `api.ts`). Default `access: 3`; without `cms.accessRules` it stays 3, so
  everything is insertable.


## Caching

- Node axis: per request in `cmsCtx(ctx).accessCache` (`id:usr` effective,
  `id:usr:raw` before events).
- `module.cms_access` rules: per app (`cms.accessRules`, WeakMap) — they are on
  the guest hot path. After writing `module.cms_access` directly, call
  `invalidateStandards(app)` (`cms.accessRules/mod.ts`); the backend matrix does
  this automatically.


## Legacy note

Before 2026-07 `module.cms_access` meant "minimum level required to add" with
schema default `1`, and `grp.cms_access` was a global user level. Old rows
(`1` everywhere, `0` on backend modules) are meaningless under the current
semantics and must be reset once: `UPDATE module SET cms_access = NULL` (and
`UPDATE grp SET cms_access = NULL WHERE cms_access = 0`).
