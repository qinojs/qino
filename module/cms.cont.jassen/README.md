# cms.cont.jassen

Interactive card table module for Swiss Jassen and general card games (such as Tschau Sepp or Poker).

## Features

- **Anonymous play**: Every visitor gets an automatic session player ID with an optional pseudonym — no account required.
- **Nearby discovery**: Players can share their approximate position (in-memory only, never stored in the database) so friends nearby can join with one tap, plus a 4-character table code and shareable `?jass=CODE` link.
- **Multiple card decks**:
  - `swiss36` — Deutschschweizer Jasskarten (Schellen, Schilten, Rosen, Eicheln; 36 cards)
  - `french36` — Französische Jasskarten (♥, ♦, ♠, ♣; 36 cards)
  - `french52` — Französisches 52er-Blatt (2–Ass)
  - `german32` — Deutsches / Skat-Blatt (Eichel, Laub, Herz, Schellen; 32 cards)
- **Two modes**: Jassen (tricks, trump selection including Obenabe/Undeufe, Puur/Nell point scoring) and Free Table (draw pile + discard pile).
- **Mobile & Fullscreen**: High-DPI canvas table with tactile drag-to-play hand arc, fullscreen mode (including iOS viewport fallback and Wake Lock), and live SSE synchronization.

## Artwork Credits

- **French decks (`french36`, `french52`)**: `pub/decks/french.svg` from [htdebeer/SVG-cards](https://github.com/htdebeer/SVG-cards) (David Bellot & Huub de Beer, LGPL).
- **Swiss Jass suit emblems (`swiss36`)**: Public Domain SVGs (`EichelndeutschschweizerBlatt.svg`, `RosendeutschschweizerBlatt.svg`, `SchellendeutschschweizerBlatt.svg`, `SchiltendeutschschweizerBlatt.svg`) via Wikimedia Commons.
