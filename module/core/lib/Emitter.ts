type Listener<T> = (data: T) => void | Promise<void>;

/** Minimal typed event hub: `fire` awaits listeners in registration order.
 * A throwing listener aborts the chain by design — modules throw `Output`/`Redirect` to answer a request. */
export class Emitter<Events extends Record<string, unknown>> {
    #events: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

    on<K extends string & keyof Events>(name: K, fn: Listener<Events[K]>) {
        (this.#events[name] ??= []).push(fn);
    }

    /** Fires listeners in order and returns the (possibly mutated) event — handy for question events. */
    async fire<K extends string & keyof Events>(name: K, data: Events[K] = {} as Events[K]): Promise<Events[K]> {
        for (const fn of this.#events[name] ?? []) await fn(data);
        return data;
    }
}
