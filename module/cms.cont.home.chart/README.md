# cms.cont.home.chart

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

CMS content module for a persisted home datapoint's measurement or counter consumption curve.
Add a `cont.home.chart` node and configure numeric `datapoint` in the existing node settings.
Dependencies are `cms` and `home.history`; local `home.record` is optional. Placing the chart
publishes the datapoint: page access decides who sees it. No provider credentials reach the browser.

| Setting | Meaning |
| --- | --- |
| `datapoint` | Numeric datapoint ID. |
| `source` | auto, local or provider archive. |
| `hours` | Initial rolling window, default 24 hours. |
| `consumption` | Sum valid cumulative-counter differences per chart interval. |
| `maxGap` | Maximum source interval in seconds; zero uses datapoint interval policy. |

Buttons show the last hour, day, week, month or year, or move the period one length earlier or later;
date/time fields take the viewer's local time. Times are shown localized via `<u2-time>`. The server
requests at most 700 time buckets; SVG positions follow elapsed time; line, dots and min/max envelope
are one path each. Gauge means retain min/max envelopes. Nulls and incomplete buckets
interrupt paths. The expandable table exposes plotted values; an asterisk marks incomplete buckets.
Counter resets are not counted as consumption. Partial totals are marked, never presented as complete.
Consumption retains the counter unit; it is not a rate. No interpolation or reset compensation is inferred.

Raw history is unchanged. Bounded query output does not imply constant database cost: local reads
aggregate the selected raw range, while upstream histories are checked against their raw sample limit.
