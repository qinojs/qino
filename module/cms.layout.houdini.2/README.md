# cms.layout.houdini.2

The editorial companion to [Houdini](../cms.layout.houdini/README.md): a large
serif masthead, a separate navigation row, generous headline sizes, warm default
color and a dark footer. Body text keeps the site's identity font. No external
fonts or images are required.

Select `cms.layout.houdini.2` as the page layout. It has its own global layout
page, design settings, contents, template and site CSS. Installing both Houdini
variants does not mix their settings or contents.

The visual editor, native navigation behavior, u2 pin, file editor and editable
title starter use Houdini's existing implementation. This variant supplies its
own template and CSS; it does not fork the renderer or the design controls.

## Customization

The **Houdini 2** panel has the same color, font, spacing, button and input
controls. Empty fields use identity and this variant's defaults. Change the
heading font to a sans-serif family for a different character, change the brand
color, round the controls or replace the entire template.

| Site file | Role |
|---|---|
| `data/cms.layout.houdini.2/template.html` | Site-owned template |
| `data/cms.layout.houdini.2/pub/main.css` | Site-owned CSS, loaded last |

The file editor opens both through the panel. Updates never overwrite existing
site files. Delete the site template to use the shipped one again. Site CSS can
override `#container.houdini-2`, `#head`, `#content` and `#foot`.

The content names match Houdini's; this variant additionally provides `edition`,
an optional layout text beside the masthead for a short description, location or
edition note. Nothing is filled with sample business content. The site's name
and logo still come from identity.

The footer uses u2's `u2-skin=dark`, which recalculates the palette locally. Edit
or remove that attribute in the site template to choose another footer theme;
all footer styles can also be changed in site CSS. Print uses a light footer.

For the shared design tokens, slots, access rules and navigation behavior, see
[Houdini's README](../cms.layout.houdini/README.md).
