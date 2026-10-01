# ai1.discover

What the app is made of, for an AI that builds on it: its tables, events and tools. Each comes as a
short list, searchable by meaning, and in detail by name — so an agent looks up only what it needs
instead of reading everything.

```
tables                get { search? }   name + description of each; with search the nearest 10
table/:table          get               the table's schema, as declared
events                get { search? }   as host:event (db:table:update-after)
event/:event          get               description + data as JSON Schema
tools                 get { search? }   only the tools the caller may call
tool/:tool            get               description + parameters
```

- **Search** embeds name, description and fields (columns, data, parameters) of each in
  `embedding_ai1_discover` ([ai1.embed](../ai1.embed/)), on the first search and again when modules
  change it; unchanged entries are not embedded again. Without an embedding collection, it finds
  what contains most of the words.
- **Signed-in users:** nothing here is secret, but a search embeds its query, which costs.
- A table's `description` (next to `additionalProperties` in `dbschema.json`) is what the list shows.
