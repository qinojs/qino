/**
 * The images a tool gave an agent, e.g. a screenshot: what it saw, small; a click shows them whole in
 * u2's lightbox, all of a chat as one group to go through.
 */
export const images = (content) => {
  const shown = (Array.isArray(content) ? content : []).filter((p) => p?.type === "image").map(({ url }) => {
    const link = Object.assign(document.createElement("a"), { href: url });
    link.setAttribute("u2-lightbox", "ai-images");
    const img = Object.assign(document.createElement("img"), { src: url, alt: "" });
    img.style.cssText = "display:block; max-width:13rem; max-height:10rem";
    link.append(img);
    return link;
  });
  if (shown.length) import("@qino/u2/attr/lightbox/lightbox.js");
  return shown;
};
