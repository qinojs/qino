# cms.backend.reporting_server

The other end of [reporting](../reporting/README.md): instances post to `{appUrl}reporting`, the backend
shows them and their errors. The same error on several instances is one row; "Done" removes it everywhere,
and it comes back if an instance still has it.

An instance proves itself with the key it chose on its first report (stored as a hash). While the setting
`open` is on, any unknown instance registers that way; turn it off once all instances are known.
