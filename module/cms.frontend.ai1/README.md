# cms.frontend.ai1

An assistant in the CMS text editor (u2 `aiView`): it rewrites a field on instruction, answered by
[ai1](../ai1/) through [ai1.api](../ai1.api/), within the user's daily limit. One thread per field;
the field's allowed tags and classes go along, so the answer survives the sanitizer.

## Idea

A cms content agent ([ai1.agent](../ai1.agent/)) instead of a plain thread: its role are today's
rules, and it keeps notes as memories ("always ss, never ß"). Open: which agent (a setting, created
on install?) and how the browser starts a session with it.
