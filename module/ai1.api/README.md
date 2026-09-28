# ai1.api

The [ai1](../ai1/) capabilities for any signed-in user, shaped like the functions: `POST api/ai1.api/text`,
`text/stream` (SSE: `{ delta }`, then `{ done }` or `{ error }`; closing it cancels the call),
`structured` (with a JSON Schema), `translate`, `decide`, `embed`, `image`, `speak`. `opts`
(`model`, `prefer`) go along in the body.

Per user and day at most `settings["ai1.api"].dailyLimit` units (default 100000); above it the API
answers 429. The units come from `ai1:call` of the user's requests, so server-side calls in them
count too. Image calls count the prompt's characters and the number of images returned.

```js
await api["ai1.api"].translate.post({ text: "Hallo", to: "en" });
```
