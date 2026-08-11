import { sensoryCms } from "../cms.legacy.sensory/plugin.ts";

export const name = "cms.cont.ksbt.graphaestesieTrainingWords";
export const description = "Legacy KSBT word sensory exercise.";
export const needs = ["cms", "cms.legacy.sensory"];
export const cms = sensoryCms("words");
