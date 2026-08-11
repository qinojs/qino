cms.initNode("cont.slider.nivoSlider", (el) => {
  const slides = [...el.querySelectorAll(":scope > .-slides > .-slide")];
  if (!slides.length) return;
  const controls = [...el.querySelectorAll(":scope > .-controls > button")];
  let active = el.dataset.random === "true" ? Math.floor(Math.random() * slides.length) : Number(el.dataset.start) || 0;
  let timer;
  const show = (index) => {
    active = (index + slides.length) % slides.length;
    for (const [i, slide] of slides.entries()) slide.classList.toggle("-active", i === active);
    for (const [i, control] of controls.entries()) control.setAttribute("aria-current", i === active ? "true" : "false");
  };
  const play = () => {
    clearInterval(timer);
    if (slides.length > 1) timer = setInterval(() => show(active + 1), Number(el.dataset.pause) || 3000);
  };
  el.querySelector(":scope > .-next")?.addEventListener("click", () => { show(active + 1); play(); });
  el.querySelector(":scope > .-prev")?.addEventListener("click", () => { show(active - 1); play(); });
  for (const control of controls) control.addEventListener("click", () => { show(Number(control.dataset.slide)); play(); });
  if (el.dataset.keyboard === "true") {
    el.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") show(active - 1);
      if (event.key === "ArrowRight") show(active + 1);
    });
  }
  if (el.dataset.hover === "true") {
    el.addEventListener("mouseenter", () => clearInterval(timer));
    el.addEventListener("mouseleave", play);
  }
  show(active);
  play();
});
