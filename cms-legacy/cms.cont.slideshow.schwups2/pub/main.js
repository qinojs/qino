cms.initNode("cont.slideshow.schwups2", (el) => {
  const track = el.querySelector(".b1_slideshow > .-slides");
  const slides = [...track.children];
  if (slides.length < 2) return;

  let active = 0;
  let timer;
  const show = (index) => {
    active = (index + slides.length) % slides.length;
    for (const [i, slide] of slides.entries()) slide.classList.toggle("-active", i === active);
    if (el.dataset.type === "fade") return;
    track.style.transform = `translateX(-${slides[active].offsetLeft}px)`;
  };
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => show(active + 1), 4000);
  };
  el.querySelector(".-next")?.addEventListener("click", () => { show(active + 1); play(); });
  el.querySelector(".-prev")?.addEventListener("click", () => { show(active - 1); play(); });
  addEventListener("resize", () => show(active));
  show(0);
  play();
});
