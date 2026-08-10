cms.initNode("cont.gallery.photoswipe1", (el) => {
  const figures = [...el.querySelectorAll("figure")];
  const root = el.querySelector(".pswp");
  const items = figures.map((figure) => {
    const link = figure.querySelector(":scope > a");
    return {
      src: link.href,
      w: Number(link.dataset.width),
      h: Number(link.dataset.height),
      title: figure.querySelector("figcaption")?.innerHTML,
    };
  });
  for (const [index, figure] of figures.entries()) {
    figure.querySelector(":scope > a").addEventListener("click", (event) => {
      event.preventDefault();
      new PhotoSwipe(root, PhotoSwipeUI_Default, items, { index, bgOpacity: 1 }).init();
    });
  }
});
