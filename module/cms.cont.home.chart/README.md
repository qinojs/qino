# cms.cont.home.chart

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

A CMS content module for one home entity's measurement or cumulative-counter consumption curve.
Register through the store and add a content node with module `cont.home.chart`. Configure provider
and entity in the existing CMS node settings. Dependencies are `cms` and `home.history`; local
recording through `home.record` is optional. Reading history requires a signed-in user, including
on a public page. No credentials or provider-specific APIs reach the browser.

Settings:

| Setting | Meaning |
| --- | --- |
| `provider`, `entity` | Provider name and provider-local entity ID. |
| `source` | `auto` prefers a selected local series; `local` or `provider` selects explicitly. |
| `hours` | Initial rolling window, default 24 hours. |
| `consumption` | Show counter differences per observation interval, default false. |
| `maxGap` | Maximum connected interval in seconds, default 180; zero disables this limit. |

The form accepts explicit ISO start/end timestamps with a timezone. Axes use actual elapsed time,
not equally spaced category labels. SVG is rendered server-side without an external chart runtime;
an expandable table exposes plotted observations. Multiple content nodes can show different
entities or compare measurement and consumption views.

Only finite numeric states and non-empty numeric strings are plotted. False, empty strings,
unavailable states and non-numeric values interrupt the line. Unit changes and intervals exceeding
`maxGap` also interrupt it. Choose a gap appropriate to the provider's sampling frequency. No missing
observation is replaced by zero; gauges may legitimately be negative. `Entity.unit` supplies the
unit independently of the provider; the Home Assistant adapter maps `unit_of_measurement` to it.

Consumption means `current counter - previous counter`, in the counter's own unit, per observation
interval. The first value, resets, unit changes and gaps have no computed consumption. Following a
reset, the next valid pair starts a new segment. This is neither a rate nor a uniform hourly/daily
bucket; irregular intervals must not be compared as if their duration were equal. No interpolation,
reset compensation or average is inferred. See the established distinction between
[counters and gauges](https://prometheus.io/docs/concepts/metric_types/).

Raw history is not changed by the view. Periods exceeding the history sample limit report an error;
choose a narrower range. Long-term aggregation and retention remain separate future work.
