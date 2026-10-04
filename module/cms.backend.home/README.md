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
provider metadata and can be disabled. Existing providers are listed in a table with per-row activation and expandable configuration.
Creation forms, live observations and datapoints are sibling cards.

Live states retain their native types and include availability, update time and expandable metadata.
A failed provider does not hide healthy ones. Refresh reads current observations without polling.
Actions show discovered fields and accept optional entity targets plus an input JSON object. Calls
use the real protected API; acknowledgement is distinct from the resulting observed device state.

Each live entity can create a datapoint with name, unit, numeric/state datatype, explicit state-code
mapping, expected reporting interval and recording flag. Existing datapoint interpretation is
read-only; name/interval/recording remain editable. The datapoint table can stop/resume selections
while disconnected. Install `home.record` to persist measurements and `cms.cont.home.chart` for plots.
All configuration and datapoint changes use the existing signed-in-user API and CMS node access.

## Manual test without an external service

Activate `home.manual` and `home.record`. Add a Manual provider using only a name. Under Datapoints,
open Add datapoint, select that provider, enter name/unit and keep Record observations enabled.
An empty Entity ID receives a generated identity. In the new row, open Enter measurement and enter
any finite number; state datapoints require an integer code. Empty time means now. Explicit date/time
is entered in the browser's local timezone and stored in milliseconds.

The entered value goes through the same protected `home.record` API as other archive ingestion.
The table refreshes after saving. Recording must be enabled; invalid inputs and guest access are
rejected. Older samples enter history without replacing the latest value. Archive writes do not
synthesize device changes. Use `cms.cont.home.chart` with the datapoint ID and source `local` for plots.
