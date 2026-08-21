# shorturl

One idea: **a code stands for a URL.** Shortening returns a link you can send; following it
redirects and says so.

```ts
const link = await shorten(app, "https://example.test/some/very/long/page?with=params");
// → https://site.test/s/Ab3-x9Qm

// per recipient: one row, one marker each
await sms.send(app, { usr }, `Your invoice: ${link}/${deliveryId}`);
```

One function — `shorten` — and no API tree: links are made by server code, never by a visitor.
That is what keeps it from being an open redirect.

## Why the marker is not a link of its own

A newsletter with three links going to ten thousand people is three rows, not thirty thousand.
The code identifies the target; whatever follows it identifies who followed it, and it is stored
nowhere — `shorturl:hit` hands it on and forgets it:

```ts
app.on("shorturl:hit", ({ ctx, link, tag }) => record(...));
```

So counting clicks per campaign needs nothing (`shorturl.hits`), and counting clicks per person
is a listener plus a marker the sender already had — [messaging](../messaging/) is the one that
does it, and signs its marker so nobody can walk 1, 2, 3.

A module that shortens declares itself as `export const shortener = { shorten }`, so consumers
find it without depending on it.

## SMS pays for this

A tracked link in full form costs more than the 160 characters an SMS segment holds. That, not
tidiness, is why the path is a single character.

The code is eight characters: seven naming the target, one signing it. Forty-eight bits in all —
guessing one costs `links / 2⁴⁸` per try, and every wrong try is scored.

## Both halves are keyed

The seven are a keyed hash of the target, not a plain one. A plain hash would let anyone test a
guessed URL against a link they hold, offline, as often as they like — the one attack that never
reaches the server and so never gets scored. Keyed, a guess has to be asked.

The last one is what only this app can produce, which separates two cases that would otherwise
look identical:

- signature wrong → nobody ever got this link. `suspicious` fires, and it costs no query to say
  so: 63 of 64 made-up codes are refused before the database sees them.
- signature right, no row → it was ours and the sweep took it. `410 Gone`, and no false alarm.

The second case is the normal fate of every expired link, which is why it is worth a character
to tell it from someone typing codes.

One character is enough because a scanner does not need catching on the first try — it needs
catching before it gets anywhere, and it scores itself out after a handful of misses. Every bit
saved there goes to the half that has to keep real targets apart: 42 bits collide at around two
million links, and a link that lands on a taken code takes the next one of the same length — the
same round it will find again the next time it is shortened. Eight characters, always.
