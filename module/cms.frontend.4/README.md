# Widgets

Ein Widget ist ein JavaScript-Modul, das seine Oberflaeche selbst erzeugt, in einem Element, das
nur per Code aktiviert wird. Das Panel besteht aus Widgets; andere Module (spaeter das Backend)
koennen dieselben mounten.

```js
const media = widget("@qino/m/cms.frontend.4/pub/panel/widgets/media.js", { node });
sidebar.append(media);          // laeuft beim Einhaengen
await media.reload({ node: other });
media.remove();                 // bricht ab und raeumt auf
```

Im DOM steht ein leeres `<qcms-widget>`; `src` und Kontext liegen in einer privaten `WeakMap`.
Nur die Factory aktiviert — ein `<qcms-widget>` aus eingeschleustem HTML bleibt wirkungslos.

## Kernel

[pub/panel/widget.js](pub/panel/widget.js):

- `widget(src, context)` erzeugt das aktivierte Element; es startet beim Einhaengen. Das Modul
  bekommt es als ersten Parameter `widget` (nicht `el`: es rendert, hoert zu und laedt sich neu).
- `widget.reload(context?)`; Abort + Cleanup bei reload und Aushaengen; ein Zaehler verwirft
  veraltete Laeufe; Fehler werden als `u2-alert` angezeigt.
- `widget.html` als Tagged Template, `widget.on(type, selector?, fn)` meldet sich selbst ab.
- `widget.head` / `widget.badge` melden per `qcms-widget-head`, was der Rahmen anzeigen soll. Das
  Event bubbelt nicht, sonst uebernaehme der aeussere Rahmen den Kopf eines inneren Widgets.
- `mod.css` wird pro Root einmal adoptiert — Panel-Shadow-Root, Dialog oder Dokument.
- `widget.widget(src, context)` erzeugt ein Kind-Widget, ohne den Kernel zu importieren. Ein Kind
  stirbt mit seinem Elternteil.

Der Kernel rendert **keinen** Rahmen; den Akkordeon-Kopf baut, wer mountet:
[settings.js](pub/panel/widgets/settings.js) fuer die Settings-Liste,
[extended.js](pub/panel/widgets/extended.js) fuer seine zwei Kinder — je acht Zeilen, da der
Klick-Handler des Panels auch verschachtelte Koepfe findet und den Offen-Zustand unter
`widget=name` speichert.

## Widget-Modul schreiben

```js
export const css = `.-thing { … }`;               // optional, einmal pro Root adoptiert

export default async function (widget, { node, dialogs, signal }) {
  const data = await api.cms.node(node.id).get({}, { signal });
  widget.head = t`Titel`;
  await widget.html`<div class=-thing>…</div>`;
  widget.on('change', 'input', (inp) => …);
  return () => …;                                  // optional, Cleanup vor reload/remove
}
```

Der Kontext ist, was der Mount uebergibt, plus `signal`. Ueblich sind `node` und `dialogs`
(alert/confirm/modal des CMS-Roots).

## Routen

`widgets/:pid` liefert die Liste, `files/:pid` die Moduldateien des Nodes samt Anlegen und Loeschen,
`feedback` das Panel-Feedback.

## Mounts

Die vier Sidebars stehen in `SIDEBAR_WIDGETS` ([pub/panel/panel.js](pub/panel/panel.js)). Die
Widgets darin kommen aus `api["cms.frontend.4"].widgets(pid)` ([plugin.ts](plugin.ts)): Name, Titel
und `src` — an der `options`-Stelle das `cms.node.widget` des Moduls. Ein Eintrag kann `context`
mitgeben, der in den Widget-Kontext gemischt wird.

Widgets funktionieren auch ausserhalb des Panels:
[cms.cont.test.cmd-widget](../cms.cont.test.cmd-widget/pub/main.mjs) mountet das `media`-Widget im
**Seiteninhalt**, ueber eine Laufzeit-URL statt eines Imports, also ohne Abhaengigkeit von
`cms.frontend.4`. Mit `SelectorObserver`, weil `cms.reloadNode()` den Block per `outerHTML` ersetzt.

## TODO

- **Widgets im Seiteninhalt ohne Edit-Modus.** [cms.cont.test.cmd-widget](../cms.cont.test.cmd-widget/pub/main.mjs)
  mountet nur im Edit-Modus, weil das Widget die Admin-API und `cms.panelRoot` fuer Dialoge braucht.
  Fuer oeffentliche Widgets muessen Dialoge und Kernel ohne Panel verfuegbar sein.
- **Styling ausserhalb des Panels.** Das `css` des Widgets kommt mit, aber die gemeinsamen
  CMS-Klassen (`-styled`, `-info`, `-h1`) liegen im Panel-Root. Mit `@scope` liessen sie sich ins
  Dokument laden, ohne die Seite zu veraendern.
- **Gemeinsame CMS-Schicht.** Der Kernel liegt in `pub/panel/`. Erst verschieben, wenn das Backend
  ihn nutzt.

## Sicherheitsmodell

`src` beschreibt das Widget, erlaubt aber nicht, Code auszufuehren.

1. Nur die Factory aktiviert; URL und Kontext liegen in der `WeakMap`, nie in einem Attribut.
2. Geparstes oder von Hand gebautes Markup bleibt wirkungslos, und kein `setAttribute()` aktiviert
   oder wechselt das Modul. Im Panel-Root kennt geparstes Markup `qcms-widget` gar nicht (Scoped
   Registry: die Definition ist global, ein Element bekommt seine Registry beim Erzeugen).
3. Fremdes oder von der API geliefertes HTML kommt nie ungeprueft in den CMS-Root.
4. Jede Server-API prueft Zugriff und Eingaben selbst — ein Widget ist keine Berechtigung.
5. Wer schon beliebiges JavaScript ausfuehrt, ist ohnehin drin. Das Modell verhindert nur, dass
   aus HTML-Injection JavaScript-Ausfuehrung wird.

Offen: Punkt 3 als expliziter Vertrag (Rich-Text-Allowlist), und URLs ueber einen zentralen
Ressourcenvertrag aufloesen statt ueber Herkunft/Pfad.

## Bewusst nicht Teil davon

- Serverseitig gerenderter Widget-Inhalt, ausfuehrbare Scripts in API-HTML
- Automatische Aktivierung von handgeschriebenem Markup
- Eine Registry aus fachlichen Widget-Namen, beliebige CSS-Selektoren als Controller-API
- Persistierter Widget-Kontext im DOM
- Ein allgemeines Seiten-Content-Komponentensystem (`[qcms-id]` bleibt bei `cms.initNode`)
- Remote-Module ausserhalb des zentralen Modulvertrags
