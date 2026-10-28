# user.image

A user's profile image: the column `usr.image_id` (as in the PHP version).

- **API** (`userImage`): `get`, `put` (data: URI) and `delete` one's own image.
- **Access:** signed-in users see it, guests need a signed link.
- **`imageUrl(app, usrId, size)`** ([mod.ts](mod.ts)): for whoever shows it, such as the backend layout.
- **Block:** [cms.cont.my.image](../cms.cont.my.image/).
