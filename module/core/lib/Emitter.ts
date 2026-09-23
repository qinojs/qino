type Listener<T> = (data: T) => void | Promise<void>;

/** Typed event hub: `fire` awaits listeners in order. A throwing listener stops the chain —
 * modules throw `Output`/`Redirect` to answer a request. */
export class Emitter<Events extends Record<string, unknown>> {
    #events: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

    // `signal`: abort removes the listener (used on module unlink).
    on<K extends string & keyof Events>(name: K, fn: Listener<Events[K]>, opts?: { signal?: AbortSignal }): void {
        const signal = opts?.signal;
        if (signal?.aborted) return;
        const list = (this.#events[name] ??= []);
        list.push(fn);
        signal?.addEventListener("abort", () => {
            const i = list.indexOf(fn);
            if (i !== -1) list.splice(i, 1);
        }, { once: true });
    }

    /** Fire listeners in order and return the (possibly changed) event. */
    async fire<K extends string & keyof Events>(name: K, data: Events[K] = {} as Events[K]): Promise<Events[K]> {
        const list = this.#events[name];
        if (list) for (const fn of list) { const r = fn(data); if (r) await r; } // sync listeners cost no tick
        return data;
    }
}
