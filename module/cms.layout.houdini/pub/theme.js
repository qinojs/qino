/* The visual editor and server share the same u2 tokens. Empty values keep the site's defaults. */
export const DESIGN_MARKER = '/* Houdini design */';

export const FIELDS = [
  { group: 'Colors', key: 'color', label: 'Brand color', property: 'color', hint: '#315b49' },
  { group: 'Colors', key: 'accent', label: 'Accent color', property: 'color', hint: 'var(--color)' },
  { group: 'Colors', key: 'color-bg', label: 'Background', property: 'color', hint: '#faf9f6' },
  { group: 'Colors', key: 'color-text', label: 'Text', property: 'color', hint: '#222a25' },
  { group: 'Colors', key: 'color-area', label: 'Surfaces', property: 'color', hint: 'var(--color-lighter)' },
  { group: 'Colors', key: 'color-line', label: 'Lines', property: 'color', hint: 'var(--color-text)' },
  { group: 'Colors', key: 'color-scheme', label: 'Color scheme', property: 'color-scheme', hint: 'light dark' },
  { group: 'Typography', key: 'font-1', label: 'Body font', property: 'font-family', hint: 'system-ui, sans-serif' },
  { group: 'Typography', key: 'font-2', label: 'Heading font', property: 'font-family', hint: 'var(--font-1)' },
  { group: 'Typography', key: 'font-size', label: 'Base font size', property: 'font-size', hint: 'clamp(1rem, .95rem + .2vw, 1.125rem)' },
  { group: 'Typography', key: 'line-height', label: 'Line height', property: 'line-height', hint: '1.65' },
  { group: 'Typography', key: 'measure', label: 'Text width', property: 'max-width', hint: '70ch' },
  { group: 'Typography', key: 'heading-weight', label: 'Heading weight', property: 'font-weight', hint: '600' },
  { group: 'Typography', key: 'heading-spacing', label: 'Heading letter spacing', property: 'letter-spacing', hint: '-.035em' },
  { group: 'Typography', key: 'heading-line-height', label: 'Heading line height', property: 'line-height', hint: '1.12' },
  { group: 'Spacing', key: 'width', label: 'Content width', property: 'max-width', hint: '76rem' },
  { group: 'Spacing', key: 'gap', label: 'Base spacing', property: 'gap', hint: '1rem' },
  { group: 'Spacing', key: 'radius', label: 'Corner radius', property: 'border-radius', hint: '.5rem' },
  { group: 'Spacing', key: 'line-width', label: 'Line width', property: 'border-width', hint: '1px' },
  { group: 'Controls', key: 'control-padding-x', label: 'Horizontal padding', property: 'padding-inline', hint: '1.2em' },
  { group: 'Controls', key: 'control-padding-y', label: 'Vertical padding', property: 'padding-block', hint: '.75em' },
  { group: 'Controls', key: 'control-radius', label: 'Control radius', property: 'border-radius', hint: 'var(--radius)' },
  { group: 'Controls', key: 'control-border-width', label: 'Control border', property: 'border-width', hint: '1px' },
  { group: 'Buttons', key: 'button-color', label: 'Button background', property: 'color', hint: 'light-dark(var(--color), var(--color-light))' },
  { group: 'Buttons', key: 'button-text', label: 'Button text', property: 'color', hint: 'var(--color-bg)' },
  { group: 'Buttons', key: 'button-radius', label: 'Button radius', property: 'border-radius', hint: 'var(--control-radius)' },
  { group: 'Inputs', key: 'input-bg', label: 'Input background', property: 'color', hint: 'var(--color-bg)' },
  { group: 'Inputs', key: 'input-text', label: 'Input text', property: 'color', hint: 'var(--color-text)' },
  { group: 'Inputs', key: 'input-line', label: 'Input border color', property: 'color', hint: 'color-mix(in srgb, var(--color-line), transparent 72%)' },
  { group: 'Inputs', key: 'input-radius', label: 'Input radius', property: 'border-radius', hint: 'var(--control-radius)' },
];

/** Stay inside a CSS value and a style element, including when settings are written outside the panel.
 * @param {unknown} value */
export const safeValue = (value) => typeof value === 'string' && value.length <= 250
  && !/[;{}<>\\\u0000-\u001f\u007f]|\/\*|\*\/|!\s*important/i.test(value) ? value.trim() : '';

/** The server-built rule also provides a CSP-compatible stylesheet for editor previews.
 * @param {Record<string, unknown> | null} [values] */
export function themeCss(values = {}) {
  const declarations = FIELDS.map(({ key }) => {
    const value = safeValue(values?.[key]);
    return value ? `--${key}:${value}` : '';
  }).filter(Boolean);
  return `${DESIGN_MARKER}html{${declarations.join(';')}}`;
}
