# cms.cont.blog

Put this block on a blog page. Its own title is its heading, edited on the page; left empty, there
is none. Its direct child pages are posts, newest first. Each post uses a
normal CMS page and can contain `cms.cont.blog.post` in its main container. Set the page's
`_meta_description` for the excerpt. The publication start is the post date (new CMS pages have it
by default). Offline, private and non-searchable pages stay out of the public list and feeds.
Editors can see drafts in the list.
The archive shows 20 posts per page and links to older and newer pages.
Posts may be hidden from the site's navigation (`visible` off); they still appear in the blog.

The block adds Atom and RSS discovery links to the page head. The feeds use the current language,
post title, description and canonical page URL. They contain summaries, not the full article. A
post must have a publication start to enter either feed. A direct child page is a post even if it
uses another layout.

`cms.cont.blog.post` shows its own title as the post's heading, else the page's title; on first edit
it takes the page's title. The list and feeds keep using the page's title. It also creates a moderated comment form on first edit. Editors release comments
through the existing `cms.cont.form.entries` block. The form keeps submissions and applies its
normal validation and spam handling. The public list shows name and comment, never the e-mail
address.
