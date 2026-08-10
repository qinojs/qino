const HEE = { "&": "&amp;", '"': "&quot;", "'": "&#039;", "<": "&lt;", ">": "&gt;" };

/** Escape for HTML — the browser twin of core's `hee()`. */
export const hee = (str) => String(str ?? "").replace(/[&"'<>]/g, (c) => HEE[c]);
