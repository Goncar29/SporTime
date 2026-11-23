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
