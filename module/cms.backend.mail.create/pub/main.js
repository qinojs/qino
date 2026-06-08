document.addEventListener("change", (e) => {
  const radio = e.target;
  if (radio.name !== "sender_mode") return;
  const custom = radio.closest("td")?.querySelector("[name=sender_custom]");
  custom?.toggleAttribute("hidden", radio.value !== "custom");
});
