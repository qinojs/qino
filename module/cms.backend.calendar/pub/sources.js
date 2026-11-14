/** Named theme tokens fall back to CSS color names; all other color expressions pass through. */
export function colors(sources) {
  return new Map(sources.map(({ id, color }) => [id, color && (/^[a-z][a-z0-9-]*$/i.test(color) ? `var(--${color}, ${color})` : color)]));
}
