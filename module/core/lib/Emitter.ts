type Listener<T> = (data: T) => void | Promise<void>;

/** Minimal typed event hub: `fire` awaits listeners in registration order. */
export class Emitter<Events extends Record<string, unknown>> {
    #events: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

    on<K extends string & keyof Events>(name: K, fn: Listener<Events[K]>): void {
        (this.#events[name] ??= []).push(fn);
    }

    async fire<K extends string & keyof Events>(name: K, data: Events[K] = {} as Events[K]): Promise<void> {
        for (const fn of this.#events[name] ?? []) await fn(data);
    }
}
