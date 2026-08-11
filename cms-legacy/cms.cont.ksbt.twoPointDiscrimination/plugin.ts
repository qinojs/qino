import { sensoryCms } from "../cms.legacy.sensory/plugin.ts";

export const name = "cms.cont.ksbt.twoPointDiscrimination";
export const description = "Legacy KSBT two-point discrimination exercise.";
export const needs = ["cms", "cms.legacy.sensory"];
export const cms = sensoryCms("twopoint");
