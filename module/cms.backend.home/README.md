# cms.backend.home

This module's design, behaviour and structure are provisional and may be reworked.
Real-world use will show how it is actually used and how it should work.

Optional CMS backend for provider instances, live observations, commands and datapoint selection.
Its normal installer creates a Home automation page with a house icon. Install alongside `home`
and an adapter; Home Assistant is optional. Rules remain in `sandbox.flow`, schedules in `cron`.

Provider creation and editing use the adapter's instance schema and existing schema inputs. Enter
Home Assistant's URL and token directly. Multiple instances share an adapter independently. Saving
updates persisted configuration and reconnects that instance; it does not claim remote reachability.
Write-only secrets stay empty; blank inputs preserve stored values. Unlinked adapters retain their
provider metadata and can be disabled. Forms, live provider cards and datapoints are sibling cards.

Live states retain their native types and include availability, update time and expandable metadata.
A failed provider does not hide healthy ones. Refresh reads current observations without polling.
Actions show discovered fields and accept optional entity targets plus an input JSON object. Calls
use the real protected API; acknowledgement is distinct from the resulting observed device state.

Each live entity can create a datapoint with name, unit, numeric/state datatype, explicit state-code
mapping, expected reporting interval and recording flag. Existing datapoint interpretation is
read-only; name/interval/recording remain editable. The datapoint table can stop/resume selections
while disconnected. Install `home.record` to persist measurements and `cms.cont.home.chart` for plots.
All configuration and datapoint changes use the existing signed-in-user API and CMS node access.
