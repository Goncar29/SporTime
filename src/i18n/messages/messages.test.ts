// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { MODES } from "../../workouts/domain/workout";
import { MESSAGES } from "./index";

describe.each(["en", "es"] as const)("%s messages", (language) => {
  const messages = MESSAGES[language];

  it("name and describe every workout mode", () => {
    for (const { id } of MODES) {
      expect(messages.modes[id].label).not.toBe("");
      expect(messages.modes[id].description).not.toBe("");
    }
  });

  it("name every setting of every mode", () => {
    for (const mode of MODES) {
      for (const field of mode.fields) {
        expect(messages.fields[field.id]).not.toBe("");
      }
    }
  });
});

it("Spanish is actually translated", () => {
  expect(MESSAGES.es.start).toBe("Iniciar");
  expect(MESSAGES.es.round(1, 8)).toBe("Ronda 1/8");
  expect(MESSAGES.es.phases.setRest).toBe("Descanso entre series");
});

it("Spanish names routines and their stages", () => {
  expect(MESSAGES.es.routines).toBe("Rutinas");
  expect(MESSAGES.es.newRoutine).toBe("Nueva rutina");
  expect(MESSAGES.es.stageNumber(1)).toBe("Etapa 1");
  expect(MESSAGES.es.stageCount(1)).toBe("1 etapa");
  expect(MESSAGES.es.stageCount(3)).toBe("3 etapas");
  expect(MESSAGES.en.stageCount(1)).toBe("1 stage");
  expect(MESSAGES.en.stageCount(0)).toBe("No stages");
});

it("Spanish names the routine view and its table columns", () => {
  expect(MESSAGES.es.openRoutine("Push")).toBe("Ver Push");
  expect(MESSAGES.es.noStagesYet).toBe("Sin etapas");
  expect(MESSAGES.es.exerciseColumn).toBe("Ejercicio");
  expect(MESSAGES.es.reps).toBe("Repeticiones");
  expect(MESSAGES.es.restTime).toBe("Pausa");
  expect(MESSAGES.es.weight).toBe("Peso");
});

it("Spanish names an exercise's link and its button", () => {
  expect(MESSAGES.es.exerciseLink).toBe("Enlace");
  expect(MESSAGES.es.viewLink).toBe("Ver");
  expect(MESSAGES.es.viewLinkTo("youtube.com")).toBe("Ver youtube.com");
  expect(MESSAGES.es.viewExerciseLink("youtube.com", "Remo")).toBe("Ver youtube.com (Remo)");
  expect(MESSAGES.en.viewLink).toBe("View");
  expect(MESSAGES.en.viewLinkTo("youtube.com")).toBe("View youtube.com");
  expect(MESSAGES.en.viewExerciseLink("youtube.com", "Row")).toBe("View youtube.com (Row)");
  expect("openLink" in MESSAGES.es).toBe(false);
  expect("openExerciseLink" in MESSAGES.en).toBe(false);
});

it("names the switch to be found by email", () => {
  expect(MESSAGES.es.findByEmail).toBe("Permitir que me encuentren por email");
  expect(MESSAGES.en.findByEmail).toBe("Let people find me by email");
});
