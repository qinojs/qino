# Widgets

Ein Widget ist eine leere, programmatisch aktivierte Insel: ein JavaScript-Modul, das seine
Oberflaeche selbst erzeugt. Das Panel besteht aus solchen Widgets, und wer sonst eines braucht —
ein anderes Modul, spaeter das Backend — mountet dasselbe.

```js
const media = widget("/m/cms.frontend.4/pub/panel/widgets/media.js", { node });
sidebar.append(media);          // laeuft beim Einhaengen
await media.reload({ node: other });
media.remove();                 // bricht ab und raeumt auf
```

Im DOM steht ein `<qcms-widget>` ohne alles: `src` und Kontext liegen in einer privaten `WeakMap`.
Nur die Factory aktiviert — ein `<qcms-widget>`, das durch eingeschleustes HTML in die Seite kommt,
bleibt tot.

## Kernel

[pub/panel/widget.js](pub/panel/widget.js):

- `widget(src, context)` erzeugt das aktivierte Element; es laeuft bei connect.
- `el.reload(context?)`, Abort + Cleanup bei reload und disconnect, Generationszaehler gegen spaet
  eintreffende Laeufe, Fehlerzustand als `u2-alert`.
- `el.html` als Tagged Template, `el.on(type, selector?, fn)` mit automatischem Abmelden.
- `el.head` / `el.badge` melden per `qcms-widget-head`, was der Rahmen anzeigen soll. Das Event
  bubbelt bewusst nicht: der Rahmen hoert auf dem Element, das er selbst gemountet hat, sonst
  uebernaehme der aeussere Rahmen den Kopf eines verschachtelten Widgets.
- `mod.css` wird pro Root einmal adoptiert — Panel-Shadow-Root, Dialog oder Dokument.
- `el.widget(src, context)` erzeugt ein Kind-Widget, ohne den Kernel zu importieren. Ein Kind stirbt
  mit seinem Elternteil.

Der Kernel rendert **keinen** Rahmen. Den Akkordeon-Kopf baut, wer mountet:
[settings.js](pub/panel/widgets/settings.js) fuer die Settings-Liste,
[extended.js](pub/panel/widgets/extended.js) fuer seine zwei Kinder — je acht Zeilen, weil der
delegierte Klick-Handler des Panels verschachtelte Koepfe genauso findet und den Offen-Zustand unter
`widget=name` merkt.

## Widget-Modul schreiben

```js
export const css = `.-thing { … }`;               // optional, einmal pro Root adoptiert

export default async function (el, { node, dialogs, signal }) {
  const data = await api.cms.node(node.id).get({}, { signal });
  el.head = t`Titel`;
  await el.html`<div class=-thing>…</div>`;
  el.on('change', 'input', (inp) => …);
  return () => …;                                  // optional, Cleanup vor reload/remove
}
```

Der Kontext ist, was der Mount uebergibt, plus `signal`. Ueblich sind `node` und `dialogs`
(alert/confirm/modal des CMS-Roots).

## Routen

`widgets/:pid` liefert die Liste, `files/:pid` die Moduldateien des Nodes samt Anlegen und Loeschen,
`feedback` das Panel-Feedback. `widget/:name` ist der Rest des alten Pfads, siehe TODO.

## Mounts

Die vier Sidebars stehen in `SIDEBAR_WIDGETS` ([pub/panel/panel.js](pub/panel/panel.js)). Alles
darunter kommt aus `api["cms.frontend.4"].widgets(pid)` ([plugin.ts](plugin.ts)): Name, Titel und
entweder `src` (Widget-Modul, inklusive des modul-eigenen `cms.node.widget` in der `options`-Position)
oder nichts — dann ist es ein Container fuer den alten Renderer. Ein Eintrag darf `context` mitgeben,
das der Mount in den Widget-Kontext mischt.

Widgets sind nicht ans Panel gebunden:
[cms.cont.test.cmd-widget](../cms.cont.test.cmd-widget/pub/main.mjs) mountet das `media`-Widget in
seinen **Seiteninhalt**, ueber eine Laufzeit-URL statt eines Imports — das Modul haengt nicht von
`cms.frontend.4` ab. Ein `SelectorObserver` statt eines einmaligen Query, weil `cms.reloadNode()` den
Block per `outerHTML` ersetzt.

## TODO

- **Widgets im Seiteninhalt ohne Edit-Modus.** Heute mountet
  [cms.cont.test.cmd-widget](../cms.cont.test.cmd-widget/pub/main.mjs) nur im Edit-Modus, weil das
  Widget die Admin-API spricht und `cms.panelRoot` fuer Dialoge braucht. Fuer Widgets, die
  oeffentliche Daten zeigen, muessen Dialoge und Kernel ohne Panel erreichbar sein.
- **Styling ausserhalb des Panels.** Ein Widget im Seiteninhalt bringt sein `css` mit, aber die
  gemeinsamen CMS-Klassen (`-styled`, `-info`, `-h1`) liegen im Panel-Root. `@scope` waere der Weg,
  diese Schicht ins Dokument zu laden, ohne die Seite umzufaerben.
- **`options`.** Der letzte Container ohne `src`: die Options-UI, die jedes `cms.cont.*`-Modul selbst
  rendert ([view/widgets/options.ts](view/widgets/options.ts)). Solange die existiert, bleiben der
  `widget/:name`-Endpoint, `widgetUrl()` und der Container-Zweig in `loadWidget`. Module bringen
  stattdessen ihr eigenes `cms.node.widget` mit — der Long-Tail wandert Modul fuer Modul.
- **Gemeinsame CMS-Schicht.** Der Kernel liegt in `pub/panel/`. Sobald ein Backend-Verbraucher
  existiert, in die engste gemeinsam genutzte CMS-Browser-Schicht ziehen. Vorher nicht bewegen.

## Sicherheitsmodell

`src` beschreibt das Widget, erteilt keine Ausfuehrungsberechtigung.

1. Nur die Factory aktiviert; URL und Kontext liegen in der `WeakMap`, nie in einem Attribut.
2. Geparstes oder handgebautes Markup bleibt ohne Seiteneffekt inert, und kein `setAttribute()`
   fuehrt zu Aktivierung oder Modulwechsel. Im Panel-Root kommt die Scoped Registry dazu: dort
   aufgeloestes Markup kennt `qcms-widget` gar nicht, weil die Definition global steht und ein
   Element seine Registry beim Erzeugen bekommt.
3. Fremdes oder API-geliefertes HTML kommt nie ungeprueft in den CMS-Root.
4. Jede Server-API prueft Zugriff und Eingaben selbst — die Existenz eines Widgets ist nie eine
   Autorisierungspruefung.
5. Wer bereits beliebiges JavaScript im Origin ausfuehrt, hat die Grenze ueberschritten. Das Modell
   verhindert, dass HTML-Injection zu JavaScript-Ausfuehrung aufgewertet wird.

Offen: Punkt 3 als expliziter Vertrag (Rich-Text-Allowlist), und die Aufloesung der URL ueber einen
zentralen Ressourcenvertrag statt Herkunft/Pfad.

## Bewusst nicht Teil davon

- Serverseitig gerenderter Widget-Inhalt, ausfuehrbare Scripts in API-HTML
- Automatische Aktivierung von handgeschriebenem Markup
- Eine Registry aus fachlichen Widget-Namen, beliebige CSS-Selektoren als Controller-API
- Persistierter Widget-Kontext im DOM
- Ein allgemeines Seiten-Content-Komponentensystem (`[qcms-id]` bleibt bei `cms.initNode`)
- Remote-Module ausserhalb des zentralen Modulvertrags
