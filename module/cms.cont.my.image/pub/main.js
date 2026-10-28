import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

const userImage = api["user.image"];

cms.initNode("cont.my.image", async (el) => {
  const upload = el.querySelector("[data-upload]");
  if (!upload) return;
  const msg = el.querySelector(".-msg");
  const figure = el.querySelector("[data-image]");
  const labels = { saved: await t`Saved.`, error: await t`Error loading.` };
  const show = (value = "") => void (msg.value = value);
  const fail = (e) => show(e?.message || String(e));
  const image = (url) => {
    figure.hidden = !url;
    if (url) figure.querySelector("img").src = url;
  };

  try {
    image((await userImage.get()).image);
  } catch (e) { show(labels.error + " " + (e?.message || String(e))); }

  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    show();
    try {
      image((await userImage.put({ dataUrl: await dataUrl(file) })).image);
      show(labels.saved);
    } catch (e) { fail(e); }
    upload.value = "";
  });

  figure.querySelector("[data-remove]").addEventListener("click", async () => {
    show();
    try {
      await userImage.delete();
      image(null);
    } catch (e) { fail(e); }
  });
});

const dataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
