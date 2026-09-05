export async function qgfileUpload(file, name, options) {
  const fileName = file.name || 'file.' + file.type.replace(/.*\/([^ ;]+).*/, '$1');
  if (isImage(file) && file.size > qgfileUpload.clientResizeSize) {
    const img = await toImage(file);
    await scaleToArea(img, 3000 * 3000);
    upload(await toBlob(img, file.type, 1));
  } else {
    upload(file);
  }

  function upload(blob) {
    const formData = new FormData();
    formData.append(name, blob, fileName);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', options.url || location.href);
    if (xhr.upload) xhr.upload.onprogress = e => options.progress?.(e);
    xhr.onload = () => options.complete?.(xhr.status < 400
      ? xhr.responseText
      : JSON.stringify({ error: xhr.responseText || xhr.statusText || `HTTP ${xhr.status}` }));
    xhr.onerror = () => options.complete?.(JSON.stringify({ error: 'Upload failed' }));
    xhr.send(formData);
  }
}
qgfileUpload.clientResizeSize = 6000000;

export function isImage(blob) {
  return blob.type ? blob.type.startsWith('image/') : /(jpg|jpeg|gif|png)$/i.test(blob.name);
}

export function toImage(blob, img = document.createElement('img')) {
  const url = URL.createObjectURL(blob);
  return new Promise(resolve => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      img.onload = null;
      resolve(img);
    };
    img.src = url;
  });
}

export function toBlob(img, type, quality) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.convertToBlob({ type, quality });
}

async function scaleToArea(img, area) {
  const factor = Math.min(Math.sqrt(area / (img.width * img.height)), 1);
  const canvas = new OffscreenCanvas(Math.floor(img.width * factor), Math.floor(img.height * factor));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  await toImage(await canvas.convertToBlob(), img);
}
