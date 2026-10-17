# starter.account

A personal account area on top of [starter.cms](../starter.cms/README.md).

- *My account* with the login form, and below it *Passkeys*, *Two-factor* (authenticator app and
  backup codes) and *Devices*.
- Passkey login on the login page, above the password form.
- The superuser pages for passkeys, authenticator apps and backup codes.

Passkeys only work once `auth.webauthn.rpId` names the site's domain.
