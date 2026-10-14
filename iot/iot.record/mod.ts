import { ApiError } from "@qino/qino";
import { datapoint } from "@qino/qino/home";

import { write } from "./lib/write.ts";

import type { App } from "@qino/qino";

/** Store a typed observation, retaining source time; repeated timestamps replace the prior value. */
export async function record(app: App, id: number, value: number | null, time = Date.now()): Promise<void> {
  const point = await datapoint(app, id);
  if (!point.record) throw new ApiError(409, "Enable recording before entering measurements");
  await write(app, point, value, time);
}
