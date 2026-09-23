# CMS access system

One scale everywhere: **0 none · 1 read · 2 edit · 3 admin** (`lib/access.ts`).
`usr.superuser` is a **flag**, not a level — a superuser always has 3 and skips
all rules below.

Two independent axes, combined with `min`:

```
effective(user, node) = min( node axis, module axis of the node's own module )
```

- The **node axis** is part of `cms` and works without other modules.
- The **module axis** is optional (module `cms.accessRules`).

Principle: **access = usage**. Whoever reaches a node may use all functions of its
module — no extra superuser checks in module code. Backend pages are normal CMS
pages with the same rules.


## Node axis (core)

Per node; the *highest* grant wins:

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

A node with `access = null` takes its parent's node-axis value (**before** the
module axis, see invariants) and combines it with its own grants.

Computed in `Node.access()` / `#calcUsrAccess` (`lib/Node.ts`), cached per
request in `cmsCtx(ctx).accessCache`. Other modules can adjust the result in the
`node:access` event.

Backend UI: *cms.backend.cms.tree.access* (per-page group matrix),
*cms.backend.groups* (groups & members).


## Module axis (optional module `cms.accessRules`)

"What may this user do with content of module X?" — independent of the node.
Three sources:

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
- **3 insertable (admin)** — also: the module shows up in the add-picker and
  can be assigned to nodes (`contents.post`, `module.put`). This is an editorial
  rule, not a security one — assigning a module never raises rights (the axis only
  lowers). Example: the superuser places a special module once (`standard = 2`);
  editors can edit its texts but not add new ones.

Backend UI: *cms.backend.cms.accessRules* — one matrix for all three sources
(CAP row, standard column, override cells).


## Invariants

1. **A logged-in user never sees less than a guest.** The module axis only
   limits editing: the result never drops below the guest level
   (`isPublic ? 1 : 0`). Exception: `standard = 0` hides the module for everyone.
2. **Module limits are not inherited.** A node inherits its parent's *raw*
   node-axis value (`Node.#rawAccess`), so rules of a container/layout module
   apply to that node only, not its children.
3. **An override never exceeds the group's CAP** (`min`), and a CAP never gives
   anyone *more* than the node axis.
4. **Superusers skip the module axis** and always have 3.


## Events (between cms and cms.accessRules)

- `node:access` `{ node, user, access }` — fired by `Node.access()` with the raw
  node-axis value; handlers change `access` for **this node only**.
  `cms.accessRules` applies the module axis here.
- `module:access` `{ module, user, access }` — for the module axis without a node
  (add-picker `add.ts`, `requireModuleAdmin` in `api.ts`). Default `access: 3`;
  without `cms.accessRules` everything is insertable.


## Caching

- Node axis: per request in `cmsCtx(ctx).accessCache` (`id:usr` effective,
  `id:usr:raw` before events).
- `module.cms_access`: per app (`cms.accessRules`, WeakMap), since every guest
  request reads it. After writing `module.cms_access` directly, call
  `invalidateStandards(app)` (`cms.accessRules/mod.ts`); the backend matrix does
  this itself.


## Legacy note

Before 2026-07, `module.cms_access` meant "minimum level to add" (default `1`),
and `grp.cms_access` was a global user level. Old values (`1` everywhere, `0` on
backend modules) are wrong now and must be reset once: `UPDATE module SET cms_access = NULL` (and
`UPDATE grp SET cms_access = NULL WHERE cms_access = 0`).
