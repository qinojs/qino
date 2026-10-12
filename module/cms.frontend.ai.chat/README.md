# cms.frontend.ai.chat

The site assistant as an item of the CMS panel's sidebar, beside "Structure" and "Settings", in edit mode
for those who may edit the page (access 2 and up). It mounts into the panel as
[cms.versions](../cms.versions/) does, its css through the panel root's `addStyle()`. It talks with the
agent `cms.frontend.ai.chat/assistant` ([agents/assistant.md](agents/assistant.md), see
[ai.agent](../ai.agent/)), all through ai.agent's api.

- **Tools** that read and write: pages and contents, texts, versions, images, files, the layout, app
  settings, the web and image generation. The agent acts with the user's rights: it can do what they
  may, no more. With this many, it is given those closest to its role and finds the others itself.
- **One session per user that stays:** kept in the user's settings (`session`), across pages, reloads
  and devices. "New conversation" starts another one and keeps that. Long sessions are compacted by
  [ai.agent.sleep](../ai.agent.sleep/) where it is installed.
- **Where the user is** goes to the agent as a note before the next question, once per page:
  `On page 45 "/de/team", editmode on`.
- **Show:** in this mode the element under the pointer is marked; a click gives it to the agent as a
  note instead of to the page, one fact a line: the element, the content nodes it is in (module, id,
  name), the text field (`cmstxt` id), link url, image src and sizes, form field (never a password),
  its text, a selection in it, and its path in the node's html as a css selector.
- Show mode catches pointer, click and Esc on `window`, before the page, the editor and the panel.

## Api

```
session   get    your session with the assistant, started if there is none → { id }
session   post   a new one, kept from now on → { id }
```

## Shared with cms.backend.ai.chat

Both chats do the same in the browser, written twice for now; a place for it could be a browser client
of a session in ai.agent (`pub/chat.js`):

- a message as an entry: answers as markdown, what was said as text, errors marked
- polling with `after` and `running`, the send button as stop button (`cancel`)
- Enter sends, Shift + Enter makes a new line; not while composing, not on touch screens
- the log staying at its end while it grows, unless scrolled up
