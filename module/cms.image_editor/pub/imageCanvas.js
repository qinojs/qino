/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

// Small image-editing surface on a 2D canvas (replaces the Seriously WebGL stack).
//
// - brightness/contrast are live, non-destructive `ctx.filter` adjustments
//   (re-applied on every render), so they stay editable after crop/rotate.
// - crop/rotate bake the geometry into a fresh source bitmap; the live
//   adjustments are kept and re-applied on top.
// - the visible canvas always holds the final pixels, so toBlob()/hasAlpha()
//   read straight from it.
export class ImageCanvas {
    #canvas;
    #ctx;
    #source = null;
    brightness = 1;
    contrast = 1;

    constructor(canvas) {
        this.#canvas = canvas;
        this.#ctx = canvas.getContext('2d');
    }

    get width()  { return this.#canvas.width; }
    get height() { return this.#canvas.height; }

    /** Load a fresh image (resets brightness/contrast). */
    load(source) {
        this.brightness = 1;
        this.contrast = 1;
        this.#replace(source);
    }

    /** Re-draw the current source with the current brightness/contrast. */
    render() {
        if (!this.#source) return;
        this.#ctx.filter = `brightness(${this.brightness}) contrast(${this.contrast})`;
        this.#ctx.clearRect(0, 0, this.width, this.height);
        this.#ctx.drawImage(this.#source, 0, 0, this.width, this.height);
    }

    /** Crop to a rect in canvas pixels; adjustments stay live. */
    async crop(x, y, w, h) {
        this.#replace(await bake(w, h, c => c.drawImage(this.#source, x, y, w, h, 0, 0, w, h)));
    }

    /** Rotate 90° clockwise; adjustments stay live. */
    async rotateRight() {
        const { width: w, height: h } = this;
        this.#replace(await bake(h, w, c => {
            c.translate(h, 0);
            c.rotate(Math.PI / 2);
            c.drawImage(this.#source, 0, 0);
        }));
    }

    /**
     * Bounding box of content that differs from the top-left corner colour
     * (auto-trim of a uniform border). Returns null if the image is uniform.
     * @param tolerance allowed per-channel difference, 0–255.
     */
    contentBox(tolerance = 16) {
        const w = this.width, h = this.height;
        if (!w || !h) return null;
        const { data } = this.#ctx.getImageData(0, 0, w, h);
        const r = data[0], g = data[1], b = data[2], a = data[3];
        const differs = i =>
            Math.abs(data[i]     - r) > tolerance ||
            Math.abs(data[i + 1] - g) > tolerance ||
            Math.abs(data[i + 2] - b) > tolerance ||
            Math.abs(data[i + 3] - a) > tolerance;
        const rowHasContent = y => { const o = y * w * 4; for (let x = 0; x < w; x++) if (differs(o + x * 4)) return true; return false; };
        const colHasContent = x => { for (let y = 0; y < h; y++) if (differs((y * w + x) * 4)) return true; return false; };

        let top = 0;
        while (top < h && !rowHasContent(top)) top++;
        if (top === h) return null; // fully uniform → nothing to trim
        let bottom = h - 1; while (bottom > top && !rowHasContent(bottom)) bottom--;
        let left = 0; while (left < w && !colHasContent(left)) left++;
        let right = w - 1; while (right > left && !colHasContent(right)) right--;
        // Keep a 1px safety margin: anti-aliased edges may fall within tolerance, so never trim into content.
        top = Math.max(0, top - 1); left = Math.max(0, left - 1);
        bottom = Math.min(h - 1, bottom + 1); right = Math.min(w - 1, right + 1);
        return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    }

    toBlob(type, quality) {
        return new Promise(resolve => this.#canvas.toBlob(resolve, type, quality));
    }

    /** True if the rendered result has any transparency (→ should be saved as PNG). */
    hasAlpha() {
        const { data } = this.#ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
        return false;
    }

    #replace(source) {
        this.#source = source;
        this.#canvas.width = source.naturalWidth ?? source.width;
        this.#canvas.height = source.naturalHeight ?? source.height;
        this.render();
    }
}

// Draw into an offscreen canvas and freeze it as an ImageBitmap (the new source).
async function bake(width, height, draw) {
    const off = new OffscreenCanvas(width, height);
    draw(off.getContext('2d'));
    return await createImageBitmap(off);
}
