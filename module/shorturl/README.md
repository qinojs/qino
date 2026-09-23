# shorturl

**A code stands for a URL.** `shorten()` returns a short link; opening it redirects and fires an
event.

```ts
const link = await shorten(app, "https://example.test/some/very/long/page?with=params");
// → https://site.test/s/Ab3-x9Qm

// per recipient: one row, one marker each
await sms.send(app, { usr }, `Your invoice: ${link}/${deliveryId}`);
```

Only one function, `shorten`, and no API tree: only server code creates links, never a visitor.
So it can't be abused as an open redirect.

## Why the marker is not a link of its own

A newsletter with three links to ten thousand people is three rows, not thirty thousand. The code
identifies the target; what follows it (the marker) identifies who clicked. The marker is not
stored — `shorturl:hit` passes it on:

```ts
app.on("shorturl:hit", ({ ctx, link, tag }) => record(...));
```

Clicks per link are counted for free (`shorturl.hits`); clicks per person need a listener and a
marker. [messaging](../messaging/) does that and signs its marker so nobody can count through
numbers.

The module exports `shortener = { shorten }`, so others can find it without depending on it.

## SMS pays for this

A full tracked link would not fit into a 160-character SMS segment. That is why the path is a
single character.

The code has eight characters: seven for the target, one signature. 48 bits in total — a guess hits
with probability `links / 2⁴⁸`, and every wrong guess counts as suspicious.

## Both halves are keyed

The seven characters are a keyed hash of the target. With a plain hash, anyone could test guessed
URLs against a link offline, without the server noticing. With a key, every guess must go to the
server.

The signature character can only be produced by this app. It separates two cases:

- signature wrong → this link was never issued. `suspicious` fires, without a query: 63 of 64
  made-up codes are rejected before the database.
- signature right, no row → it was ours and has been cleaned up. `410 Gone`, no false alarm.

The second case is what happens to every expired link, so it is worth one character.

One character is enough: a scanner need not be caught on the first try, only before it gets
anywhere, and it is flagged after a few misses. The remaining bits keep real targets apart: 42 bits
collide around two million links. On a collision the next free code of the same length is taken —
and found again the same way on the next `shorten`. Always eight characters.
