type Listener<T> = (data: T) => void | Promise<void>;

/** Minimal typed event hub: `fire` awaits listeners in registration order.
 * A throwing listener aborts the chain by design — modules throw `Output`/`Redirect` to answer a request. */
export class Emitter<Events extends Record<string, unknown>> {
    #events: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

    // `signal`: abort removes the listener again — the handle for runtime module unlink.
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

    /** Fires listeners in order and returns the (possibly mutated) event — handy for question events. */
    async fire<K extends string & keyof Events>(name: K, data: Events[K] = {} as Events[K]): Promise<Events[K]> {
        const list = this.#events[name];
        if (list) for (const fn of list) { const r = fn(data); if (r) await r; } // synchronous listeners cost no tick
        return data;
    }
}
