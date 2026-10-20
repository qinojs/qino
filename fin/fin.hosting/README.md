# fin.hosting

Fin for hosting providers: the domains of customers, what is an alias of what, and the
subscriptions each domain is billed by — its hosting, the domain itself, a service.

```ts
import { adopt, blockers, domains, link, prune, remove, save, subscriptionsBy, unlink } from "@qino/qino/fin.hosting";

await save(app, "example.ch", { usrId: 42, registrar: "Hostpoint" });
await save(app, "example.com", { aliasOf: "example.ch" }); // served by example.ch's hosting, its owner too
await link(app, "example.ch", subscriptionId); // the subscription's ref becomes fin.hosting:example.ch
await unlink(app, "example.ch", subscriptionId);
await domains(app, 42); // a customer's, each alias right after its domain
await subscriptionsBy(app, 42); // their subscriptions, by domain
await blockers(app, "example.ch"); // ["aliases", "running", "unpaid"]: why it may not go
await remove(app, "example.com");
await prune(app); // every domain linked to nothing
```

The domain is the key (`fin_hosting_domain.name`, lower case, punycode). A subscription is for a
domain through its `ref` (`fin.hosting:example.ch`), the convention all of fin uses — so plans,
prices, periods and billing stay [fin.subscription](../fin.subscription/README.md)'s. An alias is
one level deep, served by its domain's hosting and its domain's customer's; it may cost on its own
(the domain itself). The bills always fit the owner: only the owner's subscriptions are linked (a
domain without one takes the subscription's customer), and a domain does not change hands while
subscriptions still run for it.

**Nothing to link by hand, mostly.** A subscription named after a domain is for it: "Hosting
example.ch", or a plan's subscription whose name is the detail "example.ch". When it is saved
(`subscription:save`), the domain is added as the customer's, if it is not there, and linked —
unless the domain is another customer's. By hand remains what no name tells: an alias.

**What to bill.** A domain we registered (`registrar` set) is billed, unless it is `free` (ours, or
given); one the customer keeps elsewhere (no `registrar`) costs us nothing. `open(app)` lists what is
still to do: such a domain without a customer, or a customer's without a running subscription.

**Registrars.** A module declaring `export const domainRegistrar = { name, domains(app) }` lists the
domains registered there; a daily job (`sync`) takes them over — new ones show up without a customer,
ones no longer there lose their `registrar` (moved away, or ended), each gets its `expires`. A
registrar that fails changes nothing. The first: [fin.hosting.infomaniak](../fin.hosting.infomaniak/README.md).

**Held, not deleted.** A domain a registrar's sync brings back, with aliases, a running subscription
or an unpaid invoice of one cannot be removed; ended subscriptions keep their `ref`, so what they were
for stays readable. `prune` clears out the rest: what no subscription, ended or not, and no alias links to.
That is why the domains live here and not in a monitor: monitoring is a tool, billing is not.

**Monitored.** Where [cms.backend.domain_monitor](../../ops/cms.backend.domain_monitor/) is
installed, every saved domain is watched there (daily). Removing it there only stops the checks.

Which project serves a domain is not kept here: the web server's configuration knows it
([cms.backend.hosting](../../ops/cms.backend.hosting/README.md)).

The backend is [cms.backend.superuser.fin.hosting](../cms.backend.superuser.fin.hosting/), the
customer's own list [cms.cont.fin.my.domains](../cms.cont.fin.my.domains/).
