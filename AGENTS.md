# Qino maintenance

- Reuse the existing checkout and task context; do not restart repository discovery unnecessarily.
- Prefer one batch PR containing several independent safe cleanups over one PR per tiny correction.
- Accept only changes with no behavior change, no added complexity, and code size that is unchanged or smaller.
- Preserve the project's existing conventions, public explicit types, and lines of at most 120 characters.
- Prefer removing dead or redundant code; do not trade readability for fewer bytes.
- Scan once, edit the complete batch, then run relevant diff, lint, type, and test checks once at the end.
- Keep tool output concise and show detailed logs only for failures.
- If a dependency or registry failure repeats, stop retrying and report the environmental limitation.
- Base the batch on the current `main`; keep all edits reviewable and avoid unrelated feature changes.
