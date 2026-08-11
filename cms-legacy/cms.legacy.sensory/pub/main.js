for (const root of document.querySelectorAll("[data-sensory]")) {
  const form = root.querySelector("form"), setup = root.querySelector(".-setup"), round = root.querySelector(".-round"), prompt = root.querySelector(".-prompt");
  const words = "Eis und Kuh Muh Mäh Sex ich Hit Hai Mal Tor Mai wie was das der von vor nur wer Tag Tim Tom pur mit Heu Zug Bad Mut Bus Deo Fan Öse Oma Opa Lea Fee Tee Ohr Reh Sie fit uns neu Bär Ort Huf Lot Wal Rad Gel Rom Tür Ode Pol Bar Hut Ego Ehe See Uhr Zoo Elf Uhu Eva Gnu Uri hoi hey Beo Ida Eid Ära Abt Max Cup Arm Box Mix Abo Gag Ost Rat Tat Tau Dip Wut Rot lau".split(" ");
  let attempts = 0, correct = 0;
  const next = () => {
    if (attempts >= Number(root.dataset.total)) {
      form.elements.value.value = Math.round(correct / attempts * 100);
      form.requestSubmit();
      return;
    }
    attempts++;
    prompt.textContent = root.dataset.sensory === "alphabet"
      ? "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]
      : root.dataset.sensory === "words"
      ? words[Math.floor(Math.random() * words.length)]
      : String(1 + Math.floor(Math.random() * Number(form.elements.count.value)));
  };
  root.querySelector(".-start").addEventListener("click", () => { setup.hidden = true; round.hidden = false; next(); });
  root.querySelector(".-right").addEventListener("click", () => { correct++; next(); });
  root.querySelector(".-wrong").addEventListener("click", next);
}
