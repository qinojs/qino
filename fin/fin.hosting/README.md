# fin.hosting

Fin for hosting providers: the domains of customers, where each is registered and where hosted,
what is an alias of what, and the subscriptions each domain is billed by — its registration, its
hosting, a service.

```ts
import { adopt, blockers, domains, link, open, prune, remove, save, subscriptionsBy, sync, unlink } from "@qino/qino/fin.hosting";

await save(app, "example.ch", { usrId: 42, registrar: "Hostpoint", host: "plesk:s3.example.com" });
await save(app, "example.com", { aliasOf: "example.ch" }); // served by example.ch's hosting, its owner too
await link(app, "example.ch", subscriptionId, "hosting"); // its ref becomes fin.hosting:example.ch/hosting
await unlink(app, "example.ch", subscriptionId);
await domains(app, 42); // a customer's, each alias right after its domain
await subscriptionsBy(app, 42); // their subscriptions, by domain
await open(app); // what we bill for without a customer or a subscription
await sync(app); // take over what the registrars and hosts hold
await blockers(app, "example.ch"); // ["synced", "aliases", "running", "unpaid"]: why it may not go
await remove(app, "example.com");
await prune(app); // every domain linked to nothing
```

The domain is the key (`fin_hosting_domain.name`, lower case, punycode). A subscription is for a
domain through its `ref`, the convention all of fin uses — so plans, prices, periods and billing stay
[fin.subscription](../fin.subscription/README.md)'s. The ref names what it pays for:
`fin.hosting:example.ch/domain` its registration, `fin.hosting:example.ch/hosting` its hosting,
`fin.hosting:example.ch` anything else, a service. The bills always fit the owner: only the owner's
subscriptions are linked (a domain without one takes the subscription's customer), and a domain does
not change hands while subscriptions still run for it.

**Registered, hosted — apart.** Where a domain is registered (`registrar`) and where it is hosted
(`host`) are two things: we may register one the customer hosts elsewhere, host one the customer
registered themselves (or a subdomain, which is registered with its parent), or both. Each is billed,
unless the domain is ours.

**Whose.** `usr_id` is the customer, `0` (`OURS`) ours, none not assigned yet. Ours costs nothing; one
given to a customer is billed by a subscription at price 0 — so it shows with them, per kind, and may
cost later. A new subdomain is its parent's owner's; one without owner becomes theirs as they get one.
An alias is one level deep, served by its domain's hosting — it has no host of its own — and its
domain's customer's; its registration may cost.

**Nothing to link by hand, mostly.** A subscription named after a domain is for it: "Hosting
example.ch", or a plan's subscription whose name is the detail "example.ch", for what its or its
plan's name says (`domain`, `hosting`, else anything). When it is saved (`subscription:save`), the
domain is added as the customer's, if it is not there, and linked — unless the domain is another
customer's.

**What to bill.** `open(app)` lists what is still to do: a domain we register or host not assigned
yet, or a customer's without a running subscription for its registration or its hosting.

**Registrars and hosts.** A module declares where domains are: `export const domainRegistrars = (app)
=> Source[]` where they are registered, `export const domainHosts = (app) => Source[]` where hosted —
a source each, `{ name, domains() }`, so one module may bring several (a server each). A daily job
(`sync`) takes them over: new domains show up without a customer, a registrar's with its `expires`, a
host's with its aliases; one no longer there loses its `registrar` or `host` (moved away, or ended),
an alias its host no longer lists its domain. A source that fails changes nothing. They are
[fin.hosting.infomaniak](../fin.hosting.infomaniak/README.md) and [fin.hosting.plesk](../fin.hosting.plesk/README.md).

**Held, not deleted.** A domain a sync brings back, with aliases, a running subscription or an unpaid
invoice of one cannot be removed; ended subscriptions keep their `ref`, so what they were for stays
readable. `prune` clears out the rest: what no subscription, ended or not, no alias and no host links to.
That is why the domains live here and not in a monitor: monitoring is a tool, billing is not.

**Monitored.** Where [cms.backend.domain_monitor](../../ops/cms.backend.domain_monitor/) is
installed, every saved domain is watched there (daily). Removing it there only stops the checks.

The backend is [cms.backend.superuser.fin.hosting](../cms.backend.superuser.fin.hosting/), the
customer's own list [cms.cont.fin.my.domains](../cms.cont.fin.my.domains/).
