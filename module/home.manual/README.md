# home.manual

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

A manual adapter for the existing provider → datapoint → measurement model. No external service,
URL or credentials are needed. Register `home.manual` and `home.record` through the existing store;
use `cms.backend.home` to enter values and `cms.cont.home.chart` for curves.

## Quick test

1. Open Home automation. Under Add provider · Manual, enter a name and save.
2. Under Datapoints → Add datapoint, select that provider, enter a name and unit, choose Number,
   enable Record observations and save. Entity ID is optional; an empty ID gets a generated identity.
3. In that datapoint's row, open Enter measurement. Enter a value and save. Empty time means now;
   an explicit local date/time is converted to Unix milliseconds by the browser.
4. Repeat with another value. The row shows the latest recorded value and time. For a curve, add
   a `cont.home.chart` content node and set its numeric datapoint ID and source `local`.

For a temperature use °C, for a cumulative electricity meter use kWh, for a water level use the
actual measurement unit. Values can be negative or zero. A state datapoint accepts signed integer
codes -128..127. Multiple manual providers remain independent.

Entries are stored with `home.record`'s `record()`; stopping recording rejects entry and keeps
the archive. Backdated samples do not replace the current cache. These are archive writes:
they do not synthesize device change events or execute automation rules. The manual adapter exposes
latest recorded values as entities, including unavailable values, and has no device actions.
