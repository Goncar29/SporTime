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

it("explains a link to the local network or an IP address in both languages", () => {
  expect(MESSAGES.en.localLink).toBe("Use a website link, not a local network or IP address.");
  expect(MESSAGES.es.localLink).toBe(
    "Usa el enlace de un sitio web, no una dirección de red local o IP.",
  );
});

describe("sharing a routine (T25, S12)", () => {
  it("asks to confirm, naming the routine and every recipient in a list", () => {
    expect(MESSAGES.es.confirmShare("Piernas", ["Beto", "Ana"])).toBe(
      '¿Enviar "Piernas" a Beto y Ana?',
    );
    expect(MESSAGES.es.confirmShare("Piernas", ["Beto"])).toBe('¿Enviar "Piernas" a Beto?');
    expect(MESSAGES.en.confirmShare("Legs", ["Beto", "Ana", "Carla"])).toBe(
      'Send "Legs" to Beto, Ana, and Carla?',
    );
  });

  it("says sharing needs a connection, in the app's tone", () => {
    expect(MESSAGES.es.shareNeedsConnection).toBe("Necesitas conexión para compartir.");
    expect(MESSAGES.en.shareNeedsConnection).toBe("You need a connection to share.");
    expect(MESSAGES.es.share).toBe("Compartir");
    expect(MESSAGES.es.shareRoutine("Piernas")).toBe("Compartir Piernas");
  });

  it("names what to fix: the routine, a stage or an exercise of a stage", () => {
    expect(MESSAGES.es.shareProblem({ kind: "routineName" })).toMatch(
      /^Revisa el nombre de la rutina/,
    );
    expect(MESSAGES.es.shareProblem({ kind: "stageNotes", stage: 2 })).toMatch(
      /^Revisa los comentarios de la etapa 2/,
    );
    expect(
      MESSAGES.es.shareProblem({
        kind: "exercise",
        field: "link",
        stage: 1,
        exercise: 2,
        exerciseName: "Remo",
      }),
    ).toMatch(/^Revisa el enlace del ejercicio "Remo" de la etapa 1:/);
    expect(
      MESSAGES.en.shareProblem({ kind: "exercise", field: "reps", stage: 3, exercise: 2 }),
    ).toMatch(/^Check the reps of exercise 2 of stage 3:/);
    expect(MESSAGES.en.shareProblem({ kind: "senderName" })).toContain("100");
  });

  it.each(["en", "es"] as const)("%s explains every problem and outcome", (language) => {
    const messages = MESSAGES[language];
    const fields = ["name", "reps", "rest", "weight", "notes", "link", "empty"] as const;
    const texts = [
      messages.shareProblem({ kind: "senderName" }),
      messages.shareProblem({ kind: "senderEmail" }),
      messages.shareProblem({ kind: "routineName" }),
      messages.shareProblem({ kind: "routineNotes" }),
      messages.shareProblem({ kind: "tooManyStages" }),
      messages.shareProblem({ kind: "stageName", stage: 1 }),
      messages.shareProblem({ kind: "stageNotes", stage: 1 }),
      messages.shareProblem({ kind: "emptyStage", stage: 1 }),
      messages.shareProblem({ kind: "tooManyExercises", stage: 1 }),
      ...fields.map((field) =>
        messages.shareProblem({ kind: "exercise", field, stage: 1, exercise: 1 }),
      ),
      ...Object.values(messages.shareOutcomes),
    ];
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text).not.toBe("");
    expect(Object.keys(messages.shareOutcomes).sort()).toEqual(
      ["failed", "mayHaveArrived", "offline", "refused", "sent"].sort(),
    );
  });

  it("never calls an answer that was lost a failure", () => {
    expect(MESSAGES.es.shareOutcomes.mayHaveArrived).toMatch(/^Puede que haya llegado/);
    expect(MESSAGES.en.shareOutcomes.mayHaveArrived).toMatch(/^It may have arrived/);
  });

  it("has the same sharing messages in English and Spanish", () => {
    const shareKeys = (language: "en" | "es") =>
      Object.keys(MESSAGES[language])
        .filter((key) => /share/i.test(key))
        .sort();
    expect(shareKeys("es")).toEqual(shareKeys("en"));
  });
});

it("names routines received from contacts among the data kept and deleted (T26, S12)", () => {
  expect(MESSAGES.en.receivedFrom("Ana", "ana@example.com")).toBe(
    "Received from Ana (ana@example.com)",
  );
  expect(MESSAGES.en.receivedFrom(null, "ana@example.com")).toBe("Received from ana@example.com");
  expect(MESSAGES.es.receivedFrom("Ana", "ana@example.com")).toBe(
    "Recibida de Ana (ana@example.com)",
  );
  expect(MESSAGES.es.receivedFrom(null, "ana@example.com")).toBe("Recibida de ana@example.com");
  expect(MESSAGES.en.deleteAccountWarning).toContain(
    "your routines, including those contacts sent you,",
  );
  expect(MESSAGES.es.deleteAccountWarning).toContain(
    "tus rutinas, también las que te enviaron tus contactos,",
  );
  const kept = (language: "en" | "es") => MESSAGES[language].privacySections[0]!.body;
  const removed = (language: "en" | "es") => MESSAGES[language].privacySections.at(-1)!.body;
  expect(kept("en")).toContain("Routines a contact sends you are saved among yours");
  expect(kept("es")).toContain("Las rutinas que te envía un contacto se guardan entre las tuyas");
  expect(removed("en")).toContain("your routines, including those contacts sent you,");
  expect(removed("es")).toContain("tus rutinas, también las que te enviaron tus contactos,");
});

it("names new received routines on the list and the Profile menu (T27, S7)", () => {
  expect(MESSAGES.en.newRoutineMark).toBe("New");
  expect(MESSAGES.es.newRoutineMark).toBe("Nueva");
  expect(MESSAGES.en.openNewRoutine("Push")).toBe("Open Push, new");
  expect(MESSAGES.es.openNewRoutine("Push")).toBe("Ver Push, nueva");
  expect(MESSAGES.en.routinesMenuItem(2)).toBe("Routines · 2 new");
  expect(MESSAGES.en.routinesMenuItem(1)).toBe("Routines · 1 new");
  expect(MESSAGES.es.routinesMenuItem(2)).toBe("Rutinas · 2 nuevas");
  expect(MESSAGES.es.routinesMenuItem(1)).toBe("Rutinas · 1 nueva");
  expect(MESSAGES.en.routinesMenuLabel(2)).toBe("Routines, 2 new routines");
  expect(MESSAGES.en.routinesMenuLabel(1)).toBe("Routines, 1 new routine");
  expect(MESSAGES.es.routinesMenuLabel(2)).toBe("Rutinas, 2 rutinas nuevas");
  expect(MESSAGES.es.routinesMenuLabel(1)).toBe("Rutinas, 1 rutina nueva");
});

it("names blocking a sender, and says received routines stay (T27, S7)", () => {
  expect(MESSAGES.en.blockSender("Ana", "ana@example.com")).toBe("Block Ana (ana@example.com)");
  expect(MESSAGES.en.blockSender(null, "ana@example.com")).toBe("Block ana@example.com");
  expect(MESSAGES.es.blockSender("Ana", "ana@example.com")).toBe(
    "Bloquear a Ana (ana@example.com)",
  );
  expect(MESSAGES.es.blockSender(null, "ana@example.com")).toBe("Bloquear a ana@example.com");
  expect(MESSAGES.en.confirmBlockSender("Ana", "ana@example.com")).toBe(
    "Block Ana (ana@example.com)?",
  );
  expect(MESSAGES.es.confirmBlockSender("Ana", "ana@example.com")).toBe(
    "¿Bloquear a Ana (ana@example.com)?",
  );
  for (const language of ["en", "es"] as const) {
    const messages = MESSAGES[language];
    expect(messages.blockSenderNote).not.toBe("");
    for (const text of [
      messages.blockAction,
      messages.blocked,
      messages.noBlocked,
      messages.unblock,
      messages.unblockSender("Ana"),
      messages.blockFailed,
      messages.unblockFailed,
      messages.loadBlockedFailed,
      messages.senderBlocked("Ana", "ana@example.com"),
    ]) {
      expect(text).not.toBe("");
    }
  }
  expect(MESSAGES.en.blockSenderNote).toMatch(/won't be able to send you routines/);
  expect(MESSAGES.en.blockSenderNote).toMatch(/already received stay/);
  expect(MESSAGES.es.blockSenderNote).toMatch(/no podrá enviarte rutinas/i);
  expect(MESSAGES.es.blockSenderNote).toMatch(/ya recibiste se quedan/);
  expect(MESSAGES.es.blocked).toBe("Bloqueados");
  expect(MESSAGES.en.blocked).toBe("Blocked");
  expect(MESSAGES.es.unblock).toBe("Desbloquear");
  expect(MESSAGES.en.unblock).toBe("Unblock");
  // The sender learns only that a copy was refused, never that they were blocked.
  for (const language of ["en", "es"] as const) {
    expect(MESSAGES[language].shareOutcomes.refused).not.toMatch(/block|bloque/i);
  }
});

it("names the blocked list among the data kept and deleted (T27)", () => {
  const kept = (language: "en" | "es") => MESSAGES[language].privacySections[0]!.body;
  const device = (language: "en" | "es") => MESSAGES[language].privacySections[2]!.body;
  const removed = (language: "en" | "es") => MESSAGES[language].privacySections.at(-1)!.body;
  expect(kept("en")).toMatch(/people you block/);
  expect(kept("es")).toMatch(/personas que bloqueas/);
  expect(device("en")).toMatch(/received routines you have already seen/);
  expect(device("es")).toMatch(/rutinas recibidas que ya viste/);
  expect(removed("en")).toMatch(/the people you blocked/);
  expect(removed("es")).toMatch(/las personas que bloqueaste/);
  expect(MESSAGES.en.deleteAccountWarning).toMatch(/the people you blocked/);
  expect(MESSAGES.es.deleteAccountWarning).toMatch(/las personas que bloqueaste/);
});
