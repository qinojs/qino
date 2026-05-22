document.addEventListener("change", (e) => {
  const radio = e.target;
  if (radio.name !== "sender_mode") return;
  const custom = radio.closest("td")?.querySelector(".-sender-custom");
  if (custom) custom.style.display = radio.value === "custom" ? "block" : "none";
});
