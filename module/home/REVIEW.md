# Home redesign

Status: provider/datapoint model and typed storage implemented. This document records the
requirements, findings and remaining scaling limits; it is not a mandate to introduce new core APIs or schema vocabulary.

## Requirements

- Provider instances live in the database. Multiple instances may use the same adapter, such as
  two Home Assistant servers with different endpoints and credentials.
- Live entities and commands remain provider-independent. Qino flows own automation rules.
- Provider IDs and measurement-datapoint IDs are numeric database identities.
- Measurement timestamps retain milliseconds (confirmed by the user).
- Measurement storage contains typed values, not repeated JSON entity snapshots.
- Names, endpoints, attributes, units and connection configuration belong to metadata, not to
  every measurement row.
- Numeric measurements and small discrete states use separate typed tables, following ims1.
- Counter consumption, outages, unit changes and physical counter replacements need explicit
  semantics. Changes to metadata must not rewrite the meaning of old measurements.
- Recording policy distinguishes actual observations from connection health. Reading a cached
  value every minute is not a new device measurement.
- Chart requests must be bounded by output resolution. Large raw histories must not be loaded
  and rendered as hundreds of thousands of SVG nodes.
- Existing Qino schema, SQL, API, CMS and App-owned lifecycle conventions apply.

## Findings in ims1

Reference: `/var/www/workplace/v9/m/ims1/dbscheme.xml` (read-only).

`ims1_datapoint` holds identity, unit, current value, expected interval and storage selection.
`ims1_data_float` holds a numeric datapoint ID, timestamp, double value and optional physical
counter ID. `ims1_data_tinyint` uses a small integer value instead. The primary key is datapoint
plus time. Physical counters and their offsets are separate metadata. The averaging cache is
separate from raw values. Missing data, interpolation and counter consumption are handled by the
query layer rather than by storing fabricated entity snapshots.

## Rejected draft

`home_sample(provider string, entity string, time integer, data JSON text)` repeats addresses,
display names and attributes per observation and repeats string identities in the primary key.
It makes numeric range queries and aggregation depend on parsing JSON. Replacing TEXT with a
native JSON column would not solve the duplication.

## Storage comparison

A local SQLite comparison inserted 100,000 observations for 100 datapoint, with the same integer
millisecond timestamps and numeric states. Both cases used SQLite's ordinary rowid tables and a
composite primary-key index. The old case stored provider/entity strings and a full JSON entity;
the compact case stored only numeric datapoint ID, time and numeric value. A representative JSON
entity alone was 260 UTF-8 bytes.

| Layout | File bytes | Bytes / observation | Linear extrapolation to one billion |
| --- | ---: | ---: | ---: |
| Repeated string IDs and JSON entity | 39,886,848 | 398.86848 | 398.86848 GB |
| Numeric datapoint ID, millisecond time, double value | 4,431,872 | 44.31872 | 44.31872 GB |

GB here means decimal gigabytes. This is a controlled layout comparison, not a prediction of
actual billion-row database size. Dataset, insertion order, indexes, row format, fragmentation,
engine and compression affect the result. Metadata, logs, replication and backups are excluded.

For MySQL the compact numeric columns alone would be 4 bytes for INT datapoint ID, 8 for BIGINT
millisecond time and 8 for DOUBLE value: 20 bytes per observation, or 20 GB for one billion.
That is column payload only, not total table size. A TINYINT state reduces the value payload to
1 byte. See [MySQL storage requirements](https://dev.mysql.com/doc/refman/8.4/en/storage-requirements.html).

## Implemented responsibilities

- `home`: provider-instance and datapoint metadata, adapter discovery, live observations and commands.
- `home.homeassistant`: multiple independent connections, keyed by numeric provider ID and owned
  by the App; per-instance configuration replaces module-wide connection settings.
- `home.record`: typed measurement tables; explicit selection and
  sampling rules; no full entity JSON on the hot measurement path.
- `home.history`: compact history queries, counter semantics and bounded chart data; local and
  upstream archives remain explicitly selectable.
- `cms.backend.home`: provider-instance forms and datapoint configuration using the
  existing CMS parts, forms, schema inputs and the `home` SDK behind CMS node access.
- `cms.cont.home.values` / `cms.cont.home.chart`: existing CMS content conventions, numeric
  provider/datapoint references, live values and bounded measurement/consumption views.

Bounded chart queries currently aggregate raw SQL ranges. They do not provide constant-cost long-term
queries or a precomputed aggregate cache. Raw data is not deleted automatically. A billion-row service
requires engine-specific workload sizing, including index, log, backup and maintenance costs.

## Open ideas (not urgent, not decided)

Notes for later, no planned work. Revisit when a real case needs them.

**Topics: a logical address.** In ims1 the reporters were built for ims1 and reported `topic → value`, so
a topic was the technical and the logical address at once (`ims1_datapoint.topic`, unique). Here the
provider dictates the technical address (`event.puck_ce76_taste/event_type`). The datapoint is the link:
it could get a unique logical `topic` (e.g. `house/ground/kitchen/light`) beside its source. The topic tree
with titles and page mapping (`ims1_topic`, `ims1_topic_page`) would be a separate module on top, once
several flats or buildings need it.

**Devices: a physical identity across providers.** Qino sees entities, not the devices behind them.
Home Assistant's device registry has `identifiers` and `connections`, physical addresses such as
`("bluetooth", "F3:6A:EA:74:CE:76")` or a Zigbee IEEE address, sometimes `serial_number`, `manufacturer`,
`model`. An adapter could add an optional device with such connections to its entities. Qino could then
recognise the same device arriving through another provider (Home Assistant today, MQTT or direct
Bluetooth later) and let a datapoint follow its device, group the backend by device, detect replaced
counters by serial number (as `ims1_real_counter.serial_nr`), propose templates by model, and show
battery and last seen per device. Limits: phones randomise their Bluetooth address (only the app ID is
stable, until a reinstall), many providers know no physical address, and one device may have several.

**Stable entity references.** Datapoints and commands keep the provider's entity ID. Renaming an entity in
Home Assistant while Qino references it breaks the reference; Home Assistant's immutable `unique_id`
would survive renames.
