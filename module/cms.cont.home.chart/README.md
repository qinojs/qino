# cms.cont.home.chart

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

CMS content module for a persisted home datapoint's measurement or counter consumption curve.
Add a `cont.home.chart` node and configure numeric `datapoint` in the existing node settings.
Dependencies are `cms` and `home.history`; local `home.record` is optional. Reading history requires
a signed-in user, even on a public page. No provider credentials reach the browser.

| Setting | Meaning |
| --- | --- |
| `datapoint` | Numeric datapoint ID. |
| `source` | auto, local or provider archive. |
| `hours` | Initial rolling window, default 24 hours. |
| `consumption` | Sum valid cumulative-counter differences per chart interval. |
| `maxGap` | Maximum source interval in seconds; zero uses datapoint interval policy. |

The form accepts explicit ISO timestamps with timezone. The server requests at most 700 time buckets;
SVG positions follow elapsed time. Gauge means retain min/max envelopes. Nulls and incomplete buckets
interrupt paths. The expandable table exposes plotted values; an asterisk marks incomplete buckets.
Counter resets are not counted as consumption. Partial totals are marked, never presented as complete.
Consumption retains the counter unit; it is not a rate. No interpolation or reset compensation is inferred.

Raw history is unchanged. Bounded query output does not imply constant database cost: local reads
aggregate the selected raw range, while upstream histories are checked against their raw sample limit.
