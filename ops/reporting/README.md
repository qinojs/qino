# reporting

Reports this instance home, to an app running
[cms.backend.reporting_server](../cms.backend.reporting_server/README.md). Off until the setting `url`
names that app.

Every ten minutes, if [error_report](../../module/error_report) has new errors, else once an hour:

- the address, Qino version and commit, runtime and linked modules;
- the new errors, grouped by source, file, line and column like the error_report backend, with hits and
  first and last time. 404s and suspicious requests stay home. Files are relative to Qino (`qino/…`) or
  the app (`app/…`), so the same error matches across instances.

The first report registers the instance with an id and a key it chooses itself (settings `id`, `key`).
