# cms.frontend.ai

An assistant in the CMS text editor (u2 `aiView`): it rewrites a field on instruction, answered by
[ai](../ai/) through [ai.api](../ai.api/). One thread per field;
the field's allowed tags and classes go along, so the answer survives the sanitizer.

## Idea

A cms content agent ([ai.agent](../ai.agent/)) instead of a plain thread: its role are today's
rules, and it keeps notes as memories ("always ss, never ß"). Open: which agent (a setting, created
on install?) and how the browser starts a session with it.
