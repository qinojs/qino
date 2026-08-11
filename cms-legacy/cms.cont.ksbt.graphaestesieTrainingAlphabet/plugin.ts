import { sensoryCms } from "../cms.legacy.sensory/plugin.ts";

export const name = "cms.cont.ksbt.graphaestesieTrainingAlphabet";
export const description = "Legacy KSBT alphabet sensory exercise.";
export const needs = ["cms", "cms.legacy.sensory"];
export const cms = sensoryCms("alphabet");
