# home.record

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Optional local recording with `home_number` and `home_state`, installed through `dbschema.json`.
Dependencies are `home.history` and `cron`. `home` owns provider/datapoint metadata; this module owns
measurement rows. Nothing is recorded until a datapoint's `record` flag is enabled.

```ts
import { configure } from "@qino/qino/home";
import { record } from "@qino/qino/home.record";

const id = await configure(app, { provider: 1, entity: "sensor.energy", unit: "kWh", record: true });
await record(app, id, 123.5, Date.now()); // Trusted server ingestion.
await configure(app, { id, record: false });
```

Superuser ingestion: `POST /api/home.record/datapoint/:datapoint { time, value }`.
Use `home`'s datapoint API or backend forms to select recordings. Stopping preserves the archive.

| Table | Columns | Primary key |
| --- | --- | --- |
| `home_number` | integer datapoint, millisecond BIGINT time, nullable DOUBLE value | datapoint, time |
| `home_state` | integer datapoint, millisecond BIGINT time, nullable TINYINT value | datapoint, time |

Physical SQL types follow the active driver's existing schema conventions. State codes are signed
-128..127; textual states use an explicit metadata mapping. Boolean states map to 0/1. Numeric
strings are accepted only if nonempty and finite; booleans are not numeric gauge measurements.
Unit/type/mapping are immutable per datapoint. Mismatched units, unmapped states and unavailable
entities produce null. Metadata and credentials are never repeated in measurement rows.

`home:observe` captures actual changes and initial/reconnection snapshots; changes use the source
update time when supplied. Selection and recorder startup capture one current observation in the
background, without change rules. Repeated timestamps replace the value atomically; late observations
enter history without changing a newer current cache.

Rows are written only when something is learned: an unchanged value is skipped until the expected
interval has passed (then one row confirms the stream is alive), a repeated null is always skipped,
and no null precedes the first value. With interval zero, a steady value costs a single row. The
check runs inside the insert against the datapoint's cached latest value; late values are never skipped.
`record()` rejects datapoints that are not recorded; the insert re-checks the flag, so a selection
stopped concurrently never writes.

Expected `interval` is metadata in seconds, default zero (no guessed reporting frequency). Every
60 seconds the existing cron scheduler marks a stream unavailable once it has exceeded twice that
interval. One null gap is written; no repeated gaps or cached measurement copies follow. Recording
errors are logged without blocking other observation listeners or rules.

Local queries use half-open `[start, end)` periods and explicit overflow errors. Chart `width` requests
aggregate in SQL: mean/min/max/count for gauges, latest state for discrete datapoints, sums of valid
counter differences for consumption. Nulls, excessive intervals and counter resets mark incomplete
buckets. The immediately preceding sample is included for local counter differences at the boundary.
No interpolation, counter-reset compensation or physical counter offsets are inferred.

Raw values are retained without automatic deletion. There is no upstream backfill, partition manager
or precomputed aggregate cache. Bounded output avoids oversized responses but still scans the queried
raw range; billion-row operational sizing needs workload measurements and an aggregate/partition plan.
