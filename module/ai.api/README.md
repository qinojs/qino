# ai1.api

The [ai1](../ai1/) capabilities for any signed-in user, shaped like the functions: `POST api/ai1.api/text`,
`text/stream` (SSE: `{ delta }`, then `{ done }` or `{ error }`; closing it cancels the call),
`structured` (with a JSON Schema), `translate`, `decide`, `embed`, `image`, `speak`. `opts`
(`model`, `prefer`) go along in the body.

```js
await api["ai1.api"].translate.post({ text: "Hallo", to: "en" });
```
