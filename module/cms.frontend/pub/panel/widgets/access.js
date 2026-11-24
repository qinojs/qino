/* Shared parts of the group and user access widgets: the level table and its rows. */
import { html } from '@qino/pub/html.js';
import { t } from '../../js/t.js';

export const css = `
.-access table { width:100%; }
.-access input[type=radio] { display:block; margin:auto; }
.-access thead th { text-align:center; vertical-align:bottom; width:calc(var(--rem) * 1.5); }
.-access thead th:first-child { text-align:left; width:auto; }
.-access thead th[class^="-access-"] { writing-mode:sideways-lr; text-align: left; }
.-access .-search { width:100%; margin-bottom:.5em; }
`;

const HEAD = () => [t`no access`, t`view`, t`edit`, t`administer`];

/** The api holds rows back on a long list — then, and only then, a search is needed. */
export const partial = (res) => res.total > res.rows.length;

/** One coloured counter per granted level. */
export const levelBadges = (rows) => [1, 2, 3]
  .map((level) => ({ text: rows.filter((r) => Number(r.access) === level).length, class: '-access-' + level + '-bg' }))
  .filter((b) => b.text);

/** Search field plus the table it refills. `load` returns the rendered rows. */
export const searchable = (widget, load) =>
  widget.on('input', '.-search', async (inp) => widget.querySelector('.-rows').innerHTML = await load(inp.value));

/** One radio per level up to `max`; higher levels stay empty cells. */
export const radios = (name, access, max = 3) => [0, 1, 2, 3].map((v) => v > max ? html`<td>` :
  html`<td><input type=radio name=${name} value=${v} ${(v ? access == v : !access) ? 'checked' : ''}>`);

export const row = (label, name, access, max) => html.async`<tr>
  <td>${label}
  ${radios(name, access, max)}`;

/** The level table. `label` names the first column, `rows` are pre-rendered. */
export const table = (label, rows) => html.async`<table class=-styled>
  <thead><tr>
    <th>${label}
    ${HEAD().map((h, i) => html.async`<th class=-access-${i}>${h}`)}
  <tbody>${rows}
</table>`;
