/** Warn before submitting attachments most mail servers will reject. */
const LIMIT = 25 * 1024 * 1024;

document.addEventListener('change', e => {
  const input = e.composedPath()[0];
  if (input.type !== 'file' || !input.form) return;
  let size = 0;
  for (const other of input.form.querySelectorAll('input[type=file]')) {
    for (const file of other.files) size += file.size;
  }
  for (const warning of input.form.querySelectorAll('.-sizeWarning')) warning.hidden = size <= LIMIT;
});
