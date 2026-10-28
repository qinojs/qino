# cms.cont.login

Combined sign-in card using u2 and the existing login modules. Guests see known accounts,
password login, passkey login and the configured OAuth providers. Signed-in users see logout.
A password-reset link appears when the CMS contains a `cms.cont.password_reset` node.

The child contents `known`, `password`, `passkey`, `oauth` and `logout` remain ordinary CMS
contents with their own settings. The passkey button never sends the password form's username.
The layout supplies the visual theme; this module only arranges the controls.

```ts
await main.cont("login", "cms.cont.login");
```
