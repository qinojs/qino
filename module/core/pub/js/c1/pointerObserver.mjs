/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */

const d = document;
let touching = false;
const Observer = function(el, options) {
    this.options = c1.ext({mouse: true, touch: true, passive:true}, options);
    this.el   = el;
	this.pos  = {};
	this.last = {};
	this.posStart = {};
	this.diff = {};

	const self = this;
	const start = function(e) {
		if (e.type === 'mousedown'  && !self.options.mouse) return;
		if (e.type === 'touchstart' && !self.options.touch) return;

		let pointer = e;
		if (e.touches) {
			pointer = e.touches[0];
			if (e.touches.length > 1) return;
			self.identifier = pointer.identifier;
		}

		self.posStart = self.pos = { x: pointer.pageX, y: pointer.pageY };
		if (self.options.mouse) {
            d.addEventListener('mousemove', move);
            d.addEventListener('mouseup'  , stop);
			d.addEventListener('dragstart', stop);
		}
		if (self.options.touch) {
			d.addEventListener('touchmove', move, {passive: self.options.passive});
            d.addEventListener('touchend' , stop);
		}
		self.onstart?.(e);
		touching = true;
	};
	const move = function(e) {
		let pointer = e;

		if (e.touches) {
			pointer = e.touches[0];

			const finger2 = e.touches[1];
			if (finger2 && self.ongesture) {
				const deltaX = pointer.pageX - finger2.pageX;
				const deltaY = pointer.pageY - finger2.pageY;

				let deg = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
				e.rotate = deg -= self.degStart;

		        const dist = Math.sqrt(deltaX*deltaX + deltaY*deltaY);
				e.scale = dist / self.distStart;

				self.ongesture?.(e);
			}

			if (pointer.identifier !== self.identifier) return;
		}

		self.last = self.pos;
		self.pos = { x: pointer.pageX, y: pointer.pageY, time: e.timeStamp };
        if (self.last.x === self.pos.x && self.last.y === self.pos.y) return;
        self.diff = {
    		x:    self.pos.x - self.last.x,
    		y:    self.pos.y - self.last.y,
			time: self.pos.time - self.last.time,
    	};
        self.onmove?.(e);
	};
	const stop = function(e) {
		if (e.changedTouches) {
			if (e.changedTouches[0].identifier !== self.identifier) return;
		}
		self.onstop?.(e);
		d.removeEventListener('mousemove', move);
		d.removeEventListener('mouseup'  , stop);
		d.removeEventListener('dragstart', stop);
        d.removeEventListener('touchmove', move);
		d.removeEventListener('touchend' , stop);
		touching = false;
	};
	if (!touching) {
		el.addEventListener('mousedown', start);
	}
	el.addEventListener('touchstart', start, {passive: this.options.passive});
};
Observer.prototype.lastDiff  = function() { return { x: this.pos.x - this.last.x,     y: this.pos.y - this.last.y     }; };
Observer.prototype.startDiff = function() { return { x: this.pos.x - this.posStart.x, y: this.pos.y - this.posStart.y }; };
c1.pointerObserver = Observer;

export default c1.pointerObserver;
