# ai.api

The [ai](../ai/) capabilities for any signed-in user, shaped like the functions: `POST api/ai.api/text`,
`text/stream` (SSE: `{ delta }`, then `{ done }` or `{ error }`; closing it cancels the call),
`structured` (with a JSON Schema), `translate`, `decide`, `embed`, `image`, `speak`. `opts`
(`model`, `prefer`) go along in the body.

```js
await api["ai.api"].translate.post({ text: "Hallo", to: "en" });
```
