// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { CONTACT_LIMITS } from "../../contacts/domain/contact";
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

describe("contacts messages", () => {
  const refusals = ["invalidEmail", "notListed", "self", "duplicate", "full", "offline"] as const;

  it.each(["en", "es"] as const)("%s explains every refusal", (language) => {
    const messages = MESSAGES[language];
    expect(Object.keys(messages.contactRefusals).sort()).toEqual([...refusals].sort());
    for (const kind of refusals) expect(messages.contactRefusals[kind]).not.toBe("");
    // Who is not listed must turn the switch on, named as Profile names it.
    expect(messages.contactRefusals.notListed).toContain(messages.findByEmail);
    expect(messages.contactRefusals.full).toContain(String(CONTACT_LIMITS.contacts));
    expect(messages.noContacts).toContain(messages.findByEmail);
  });

  it("has the same contact messages in English and Spanish", () => {
    const contactKeys = (language: "en" | "es") =>
      Object.keys(MESSAGES[language])
        .filter((key) => /contact/i.test(key))
        .sort();
    expect(contactKeys("es")).toEqual(contactKeys("en"));
    expect(contactKeys("en").length).toBeGreaterThan(5);
    for (const key of contactKeys("es")) {
      expect(MESSAGES.es[key as keyof typeof MESSAGES.es]).not.toEqual(
        MESSAGES.en[key as keyof typeof MESSAGES.en],
      );
    }
  });

  it("Spanish names contacts and counts them out of the limit", () => {
    const max = CONTACT_LIMITS.contacts;
    expect(MESSAGES.es.contacts).toBe("Contactos");
    expect(MESSAGES.es.contactCount(3, max)).toBe(`3 de ${max} contactos`);
    expect(MESSAGES.en.contactCount(1, max)).toBe(`1 of ${max} contacts`);
    expect(MESSAGES.es.removeContact("Ana")).toBe("Quitar Ana");
    expect(MESSAGES.en.confirmRemoveContact("Ana")).toBe("Remove Ana from your contacts?");
  });

  it("counts contacts on the Profile menu, with a spoken name", () => {
    expect(MESSAGES.es.contactsMenuItem(3)).toBe("Contactos · 3");
    expect(MESSAGES.en.contactsMenuItem(3)).toBe("Contacts · 3");
    expect(MESSAGES.es.contactsMenuLabel(1)).toBe("Contactos, 1 contacto");
    expect(MESSAGES.es.contactsMenuLabel(3)).toBe("Contactos, 3 contactos");
    expect(MESSAGES.en.contactsMenuLabel(1)).toBe("Contacts, 1 contact");
    expect(MESSAGES.en.contactsMenuLabel(0)).toBe("Contacts, 0 contacts");
  });

  it("says on the Contacts screen that the switch lets others add you", () => {
    expect(MESSAGES.es.findByEmailContactsHint).toBe(
      "Actívalo para que otros puedan agregarte como contacto.",
    );
    expect(MESSAGES.en.findByEmailContactsHint).toBe(
      "Turn it on so others can add you as a contact.",
    );
  });

  it("names a contact the server refused to save, and whether it is still listed", () => {
    expect(MESSAGES.es.contactNotSaved("Ana", true)).toBe(
      "No pudimos guardar a Ana en el servidor; por ahora sigue en tu lista.",
    );
    expect(MESSAGES.es.contactNotSaved("Ana", false)).toBe(
      "No pudimos guardar a Ana en el servidor, así que no está en tu lista.",
    );
    expect(MESSAGES.en.contactNotSaved("Ana", false)).toBe(
      "We couldn't save Ana on the server, so they are not in your list.",
    );
  });
});
