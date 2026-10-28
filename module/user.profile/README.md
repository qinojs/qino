# user.profile

What users keep about themselves: name and organization (columns of core), and the postal address
(schema.org PostalAddress) it adds to `usr`. The image is [user.image](../user.image/)'s.

- **API** (`userProfile`): `get`/`put` one's own profile. Someone else's is edited in the backend.
- **Blocks:** [cms.cont.my.profile](../cms.cont.my.profile/) (name, organization) and
  [cms.cont.my.address](../cms.cont.my.address/).
