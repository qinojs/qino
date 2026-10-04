# home.history

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Provider-independent typed history queries. `home.record` supplies an optional local archive;
adapters may implement `history(app, providerId, entityId, { start, end })` returning native entities.

```ts
import { history } from "@qino/qino/home.history";
const result = await history(app, 17, {
  start: "2026-10-03T00:00:00Z", end: "2026-10-04T00:00:00Z", width: 700, consumption: true,
});
// result.datapoint contains metadata once; result.samples contains { time, value, ... }.
```

Authenticated route/tool: `GET /api/home.history/datapoint/:datapoint`,
`homeHistory_datapoint_get`. Both ISO timestamps require a time and timezone. Periods are half-open.

- `source: auto` prefers an actively selected or existing local archive, even when empty or stopped.
  Without one it consults the adapter. `local` requires the local module; `provider` bypasses it.
  Sources are never silently merged. Local archives remain readable when their provider is disabled/unlinked.
- `limit` defaults to 100000; overflowing raw results raise an error rather than truncate silently.
- `width` requests 1..10000 time buckets within that limit. Gauges return means and min/max/count;
  states return the latest code. Metadata and full entities are not copied into every sample.
- `consumption` requires a numeric counter. Valid consecutive differences are summed per bucket.
  The first unknown baseline, nulls, excessive gaps and decreasing counters are not consumption.
  `gap` marks incomplete intervals; a sum in such an interval is a partial total.
- `maxGap` is non-negative seconds; omitted uses twice the datapoint's expected interval. Zero disables
  the limit. No interval is assumed when the datapoint's interval is zero.

Provider samples are converted with the datapoint's declared unit/type/mapping. Unknown values stay
null. Upstream queries have a raw sample limit before in-memory aggregation; local aggregation runs
in SQL. Upstream sources may supply a period-start state and need not provide a complete event log.

An archive listens for `home.history:read`, which receives the numeric datapoint ID, start/end Unix
milliseconds, source, limit and optional width/consumption/maxGap. Set `data` to typed samples to
answer, including an empty array; leave it undefined to allow upstream history. Listeners belong to
the App and are removed through the init signal. This module creates no measurement tables itself.

Home Assistant uses its History REST API with per-instance server credentials and proxy prefix.
The History integration and recorded entity data are required. Timeouts, unlink cancellation and
redirect rejection apply. No credentials reach the browser.
