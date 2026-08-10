for (const el of document.querySelectorAll("[qcms-mod='cont.text_and_slider.cd']")) {
  const slides = [...el.querySelectorAll(".-slides > [data-id]")];
  const texts = [...el.querySelectorAll(".-content > [data-id]")];
  if (!slides.length) continue;
  let active = 0, timer;
  const show = (index) => {
    active = (index + slides.length) % slides.length;
    for (const [i, slide] of slides.entries()) slide.classList.toggle("-active", i === active);
    for (const text of texts) text.classList.toggle("-active", text.dataset.id === slides[active].dataset.id);
    slides[active].parentElement.style.transform = `translateX(-${slides[active].offsetLeft}px)`;
  };
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => show(active + 1), 8000);
  };
  el.querySelector(".-next")?.addEventListener("click", () => { show(active + 1); play(); });
  el.querySelector(".-prev")?.addEventListener("click", () => { show(active - 1); play(); });
  show(0);
  play();
}

export {};
