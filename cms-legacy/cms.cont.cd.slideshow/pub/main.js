cms.initNode("cont.cd.slideshow", (el) => {
  const slides = [...el.querySelectorAll(".b1_slideshow > .-slides > *")];
  if (slides.length < 2) return;

  let active = 0;
  let timer;
  const pagers = slides.map((slide) => {
    const pager = slide.querySelector(".-pager");
    pager.innerHTML = "<ul>" + slides.map((_, i) => "<li>" + (i + 1) + "</li>").join("") + "</ul>";
    return pager;
  });

  const show = (index) => {
    active = (index + slides.length) % slides.length;
    for (const [i, slide] of slides.entries()) slide.classList.toggle("-active", i === active);
    for (const pager of pagers) {
      for (const [i, li] of [...pager.querySelectorAll("li")].entries()) li.className = i === active ? "-active" : "";
    }
  };
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => show(active + 1), 4000);
  };

  el.addEventListener("click", (e) => {
    const li = e.target.closest(".-pager li");
    if (li) show([...li.parentNode.children].indexOf(li));
    else if (e.target.closest(".-next")) show(active + 1);
    else if (e.target.closest(".-prev")) show(active - 1);
    else return;
    play();
  });

  show(0);
  play();
});
