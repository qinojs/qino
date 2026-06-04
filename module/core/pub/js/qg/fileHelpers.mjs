/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
window.qgfileUpload = async function(f, name, opt) {
	const fileName = f.name || 'file.'+f.type.replace(/.*\/([^ ;]+).*/,'$1');
	if (f.c1IsImage() && f.size > qgfileUpload.clientResizeSize) {
		const img = await f.c1ToImage();
		await img.c1ScaleToArea(3000*3000);
		img.c1ToBlob(f.type, 1).then(upload);
	} else {
		upload(f);
	}
	function upload(blob) {
		const formData = new FormData();
		formData.append(name, blob, fileName);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', opt.url || location.href);
		if (xhr.upload) xhr.upload.onprogress = e => opt.progress?.(e);
		xhr.onload = () => opt.complete?.(xhr.responseText);
		xhr.send(formData);
	}
}
qgfileUpload.clientResizeSize = 6000000;

Blob.prototype.c1IsImage = function() {
	return this.type ? this.type.startsWith('image/') : /(jpg|jpeg|gif|png)$/i.test(this.name);
};
Blob.prototype.c1ToImage = function(img = document.createElement('img')) {
	const url = URL.createObjectURL(this);
	return new Promise(resolve => {
		img.onload = () => { URL.revokeObjectURL(url); img.onload = null; resolve(img); };
		img.src = url;
	});
};
HTMLImageElement.prototype.c1ScaleToArea = async function(area) {
	const f = Math.min(Math.sqrt(area/(this.width*this.height)), 1);
	const canvas = new OffscreenCanvas(Math.floor(this.width*f), Math.floor(this.height*f));
	canvas.getContext('2d').drawImage(this, 0, 0, canvas.width, canvas.height);
	await (await canvas.convertToBlob()).c1ToImage(this);
};
HTMLImageElement.prototype.c1ToBlob = function(type, quality) {
	const canvas = new OffscreenCanvas(this.width, this.height);
	canvas.getContext('2d').drawImage(this, 0, 0);
	return canvas.convertToBlob({ type, quality });
};
