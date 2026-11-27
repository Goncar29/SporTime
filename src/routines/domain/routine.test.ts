import { describe, expect, it } from "vite-plus/test";
import {
  ROUTINE_LIMITS,
  formatReps,
  formatRest,
  isLocalLink,
  isSenderEmail,
  linkHost,
  normalizeLink,
  normalizeRoutineName,
  parseRepsInput,
  parseRestInput,
  parseRoutine,
  parseWeightInput,
  sanitizeExercise,
  senderName,
  toStoredRoutine,
  type RoutineDraft,
} from "./routine";

describe("normalizeRoutineName", () => {
  it("trims the name and keeps any script", () => {
    expect(normalizeRoutineName("  Empuje día A 💪 ")).toBe("Empuje día A 💪");
  });

  it("requires a visible name within the limit", () => {
    expect(normalizeRoutineName("   ")).toBeNull();
    expect(normalizeRoutineName("\u200b\u0001")).toBeNull();
    expect(normalizeRoutineName("a".repeat(ROUTINE_LIMITS.nameLength))).not.toBeNull();
    expect(normalizeRoutineName("a".repeat(ROUTINE_LIMITS.nameLength + 1))).toBeNull();
  });
});

describe("parseRepsInput", () => {
  it("accepts an empty field", () => {
    expect(parseRepsInput("  ")).toEqual({});
  });

  it("accepts one value", () => {
    expect(parseRepsInput("10")).toEqual({ repsMin: 10 });
  });

  it("accepts a range like 8 - 10, with or without spaces", () => {
    expect(parseRepsInput("8 - 10")).toEqual({ repsMin: 8, repsMax: 10 });
    expect(parseRepsInput("8-10")).toEqual({ repsMin: 8, repsMax: 10 });
    expect(parseRepsInput("8 – 10")).toEqual({ repsMin: 8, repsMax: 10 });
  });

  it("reads a range of one number as that number", () => {
    expect(parseRepsInput("8-8")).toEqual({ repsMin: 8 });
  });

  it("rejects text, zero, reversed ranges and values over the limit", () => {
    expect(parseRepsInput("diez")).toBeNull();
    expect(parseRepsInput("0")).toBeNull();
    expect(parseRepsInput("10 - 8")).toBeNull();
    expect(parseRepsInput(String(ROUTINE_LIMITS.reps.max + 1))).toBeNull();
  });
});

describe("formatReps", () => {
  it("shows nothing, one value, or the range", () => {
    expect(formatReps({})).toBe("");
    expect(formatReps({ repsMin: 10 })).toBe("10");
    expect(formatReps({ repsMin: 8, repsMax: 10 })).toBe("8 - 10");
  });
});

describe("parseRestInput", () => {
  it("accepts an empty field", () => {
    expect(parseRestInput("")).toBeUndefined();
  });

  it("reads seconds written like 90, 90', 90'' or 90s", () => {
    for (const text of ["90", "90'", "90''", '90"', "90s", " 90 '' "]) {
      expect(parseRestInput(text)).toBe(90);
    }
  });

  it("reads minutes and seconds like 1:30", () => {
    expect(parseRestInput("1:30")).toBe(90);
  });

  it("rejects text and values over the limit", () => {
    expect(parseRestInput("un rato")).toBeNull();
    expect(parseRestInput("1:75")).toBeNull();
    expect(parseRestInput(String(ROUTINE_LIMITS.restSeconds.max + 1))).toBeNull();
  });

  it("is shown like 90''", () => {
    expect(formatRest(90)).toBe("90''");
  });
});

describe("parseWeightInput", () => {
  it("accepts an empty field", () => {
    expect(parseWeightInput(" ")).toBeUndefined();
  });

  it("reads whole and decimal weights, with a point or a comma", () => {
    expect(parseWeightInput("60")).toBe(60);
    expect(parseWeightInput("62.5")).toBe(62.5);
    expect(parseWeightInput("62,5")).toBe(62.5);
  });

  it("rejects text, more than one decimal and values over the limit", () => {
    expect(parseWeightInput("pesado")).toBeNull();
    expect(parseWeightInput("62.55")).toBeNull();
    expect(parseWeightInput(String(ROUTINE_LIMITS.weight.max + 1))).toBeNull();
  });
});

describe("normalizeLink", () => {
  it("rejects a link whose button would name no visible site", () => {
    expect(normalizeLink("https://www.")).toBeNull();
    expect(normalizeLink("https://\u3164.com")).toBeNull();
    expect(normalizeLink("https://.com")).toBeNull();
  });

  it("names the host the browser actually opens", () => {
    expect(linkHost(normalizeLink("https://youtube.com\\@evil.com")!)).toBe("youtube.com");
    expect(linkHost(normalizeLink("https://evil.com\\youtube.com")!)).toBe("evil.com");
    expect(linkHost(normalizeLink("https://\u0430pple.com")!)).toBe("xn--pple-43d.com");
    expect(linkHost(normalizeLink("https://youtube\u3002com")!)).toBe("youtube.com");
  });

  it("rejects slash and credential tricks and invisible characters", () => {
    for (const text of [
      "https:\\\\evil.com",
      "https:/\\evil.com",
      "https://\\evil.com",
      "//evil.com",
      "https://youtube.com%40evil.com",
      "https://youtube.com%2Fevil.com",
      "https://youtube.com\uff0fevil.com",
      "https://you\u00adtube.com",
      "https://\u202emoc.live",
      "https://x.com/\ue000",
      "https://" + "a".repeat(100_000),
    ]) {
      expect(normalizeLink(text), text).toBeNull();
    }
  });

  it("reads a line with a seventh field as nothing", () => {
    expect(
      parseRoutine("r", {
        name: "Ok",
        createdAt: 1,
        stages: [{ exercises: "Remo\t\t\t\tn\thttps://x.com\tx" }],
      })?.stages,
    ).toEqual([]);
  });

  it("is undefined when empty", () => {
    expect(normalizeLink("")).toBeUndefined();
    expect(normalizeLink("   ")).toBeUndefined();
  });

  it("keeps an https link trimmed, as typed", () => {
    expect(normalizeLink("  https://www.youtube.com/watch?v=abc  ")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(normalizeLink("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(normalizeLink("https://www.youtube.com/@canal")).toBe("https://www.youtube.com/@canal");
  });

  it("accepts up to 300 characters", () => {
    const at = (length: number) => `https://x.com/${"a".repeat(length - 14)}`;
    expect(normalizeLink(at(ROUTINE_LIMITS.linkLength))).toBe(at(ROUTINE_LIMITS.linkLength));
    expect(normalizeLink(at(ROUTINE_LIMITS.linkLength + 1))).toBeNull();
  });

  it("rejects every other scheme, credentials, spaces and broken links", () => {
    for (const text of [
      "http://x.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://user:pw@x.com",
      "https://user@x.com/a",
      "https://@x.com",
      "https:// x.com",
      "https://x.com/a b",
      "https://x.com/a\tb",
      "https://x.com/\u200bb",
      // Only the lowercase scheme, as stored and as the rules check.
      "HTTPS://X.COM",
      "https:x.com",
      "https://",
      "https:///x",
      "https://x.com:99999",
      "youtube.com/watch",
      " https://x .com",
    ]) {
      expect(normalizeLink(text), text).toBeNull();
    }
  });

  it("shows the host without www.", () => {
    expect(linkHost("https://www.youtube.com/watch?v=abc")).toBe("youtube.com");
    expect(linkHost("https://youtu.be/abc")).toBe("youtu.be");
  });
});

describe("links to the local network or an IP address (S12)", () => {
  const refuses = (text: string) => {
    expect(normalizeLink(text), text).toBeNull();
    expect(isLocalLink(text), text).toBe(true);
  };

  it("refuses localhost and any *.localhost name", () => {
    refuses("https://localhost");
    refuses("https://localhost:5173/rutina");
    refuses("https://LOCALHOST/");
    refuses("https://app.localhost");
    refuses("https://localhost.");
  });

  it("refuses a dotted IPv4 address", () => {
    refuses("https://192.168.0.1");
    refuses("https://8.8.8.8");
    refuses("https://192.168.0.1:8080/admin");
    refuses("https://8.8.8.8.");
  });

  it("refuses an all-decimal IPv4 address", () => {
    refuses("https://3232235521");
  });

  it("refuses a hexadecimal IPv4 address", () => {
    refuses("https://0xC0A80001");
    refuses("https://0xc0a80001/x");
  });

  it("refuses an IPv4 address with hexadecimal or octal parts", () => {
    refuses("https://0xC0.0250.0.1");
    refuses("https://0300.0250.0.1");
  });

  it("refuses a short IPv4 address", () => {
    refuses("https://127.1");
    refuses("https://10.1.1");
  });

  it("refuses an IPv6 address", () => {
    refuses("https://[::1]");
    refuses("https://[2001:db8::1]:8443/x");
    refuses("https://[::ffff:192.168.0.1]");
  });

  it("refuses a name of one label", () => {
    refuses("https://router");
    refuses("https://router:8080/admin");
    refuses("https://router.");
    refuses("https://www");
  });

  it("refuses the local network suffixes .local, .lan, .internal and .home.arpa", () => {
    refuses("https://nas.local");
    refuses("https://NAS.Local/fotos");
    refuses("https://printer.lan");
    refuses("https://db.internal:8443");
    refuses("https://box.home.arpa");
    refuses("https://home.arpa");
    refuses("https://nas.local.");
  });

  it("refuses a local name written with the dots the browser reads as dots", () => {
    refuses("https://nas\u3002local");
    refuses("https://192\uff0e168\uff0e0\uff0e1");
  });

  it("keeps links to named sites working", () => {
    for (const text of [
      "https://youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc&t=1s",
      "https://www.instagram.com/p/C1a2b3c4d5/",
      "https://youtu.be/abc",
      "https://localhost.com/x",
      "https://local.example.org",
      "https://lan.party.net",
      "https://123.example.com",
      "https://0xdead.beef.io",
      "https://example.io:8443/x",
    ]) {
      expect(normalizeLink(text), text).toBe(text);
      expect(isLocalLink(text), text).toBe(false);
    }
  });

  it("calls local only a link that would otherwise be safe", () => {
    expect(isLocalLink("")).toBe(false);
    expect(isLocalLink("http://localhost")).toBe(false);
    expect(isLocalLink("https://user@192.168.0.1")).toBe(false);
    expect(isLocalLink("javascript:alert(1)")).toBe(false);
    expect(isLocalLink(`https://router/${"a".repeat(ROUTINE_LIMITS.linkLength)}`)).toBe(false);
  });
});

describe("sanitizeExercise", () => {
  it("discards an exercise with no field filled", () => {
    expect(sanitizeExercise({})).toBeNull();
    expect(sanitizeExercise({ name: "  ", notes: "" })).toBeNull();
  });

  it("keeps any single field on its own", () => {
    expect(sanitizeExercise({ name: "Sentadilla" })).toEqual({ name: "Sentadilla" });
    expect(sanitizeExercise({ repsMin: 8, repsMax: 10 })).toEqual({ repsMin: 8, repsMax: 10 });
    expect(sanitizeExercise({ restSeconds: 90 })).toEqual({ restSeconds: 90 });
    expect(sanitizeExercise({ link: " https://youtu.be/abc " })).toEqual({
      link: "https://youtu.be/abc",
    });
  });

  it("drops a link that is not a safe https link", () => {
    expect(sanitizeExercise({ name: "Remo", link: "http://x.com" })).toEqual({ name: "Remo" });
    expect(sanitizeExercise({ link: "javascript:alert(1)" })).toBeNull();
    expect(sanitizeExercise({ link: 5 })).toBeNull();
  });

  it("gives a weight kg unless it says lb, and drops a unit without a weight", () => {
    expect(sanitizeExercise({ weight: 60 })).toEqual({ weight: 60, weightUnit: "kg" });
    expect(sanitizeExercise({ weight: 60, weightUnit: "lb" })).toEqual({
      weight: 60,
      weightUnit: "lb",
    });
    expect(sanitizeExercise({ name: "Remo", weightUnit: "lb" })).toEqual({ name: "Remo" });
  });

  it("drops fields that are out of range or of the wrong type", () => {
    expect(
      sanitizeExercise({
        name: "Press",
        repsMin: 0,
        restSeconds: -5,
        weight: "60",
        notes: 42,
      }),
    ).toEqual({ name: "Press" });
  });

  it("drops half of a broken character, which Firestore would refuse forever", () => {
    expect(sanitizeExercise({ name: "Remo\uD800", notes: "\uDC00lento" })).toEqual({
      name: "Remo",
      notes: "lento",
    });
    expect(normalizeRoutineName("Pierna\uD83D")).toBe("Pierna");
    expect(
      parseRoutine("r", { name: "R", notes: "a\uDFFFb", createdAt: 1, stages: [] })?.notes,
    ).toBe("ab");
    expect(normalizeRoutineName("Pecho 💪")).toBe("Pecho 💪");
  });

  it("turns control characters into spaces so text stays on one line", () => {
    expect(sanitizeExercise({ name: "Press\tbanca\nplano" })).toEqual({
      name: "Press banca plano",
    });
  });
});

const sample: RoutineDraft = {
  name: "Empuje",
  notes: "Calentar bien.\nHombros primero.",
  createdAt: 1_700_000_000_000,
  stages: [
    {
      name: "Bloque A",
      notes: "Superserie",
      exercises: [
        {
          name: "Press banca",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
          link: "https://youtu.be/abc",
        },
        { repsMin: 12 },
      ],
    },
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
};

describe("stored routines", () => {
  it("survive a round trip through the stored shape", () => {
    expect(parseRoutine("r1", toStoredRoutine(sample))).toEqual({ id: "r1", ...sample });
  });

  it("are read in the app's own shape too, as the outbox keeps them", () => {
    expect(parseRoutine("r1", sample)).toEqual({ id: "r1", ...sample });
  });

  it("store each stage's exercises as one line each, which the rules can check", () => {
    const stored = toStoredRoutine(sample);
    expect(stored.stages[0]!.exercises).toBe(
      "Press banca\t8-10\t90\t62.5kg\tPausa abajo\thttps://youtu.be/abc\n\t12\t\t\t\t",
    );
    expect(stored.stages[1]).toEqual({ exercises: "\t\t\t20lb\t\t" });
  });

  it("leave empty optional fields out instead of storing them empty", () => {
    const stored = toStoredRoutine({ name: "Solo", createdAt: 1, stages: [] });
    expect(stored).toEqual({ name: "Solo", createdAt: 1, stages: [] });
  });

  it("drop empty exercises and stages before storing", () => {
    const stored = toStoredRoutine({
      name: "Con huecos",
      createdAt: 1,
      stages: [{ exercises: [{}, { name: "Dominadas" }] }, { name: " ", exercises: [{}] }],
    });
    expect(stored.stages).toEqual([{ exercises: "Dominadas\t\t\t\t\t" }]);
  });

  it("keep at most the stage and exercise limits", () => {
    const many = Array.from({ length: ROUTINE_LIMITS.stages + 3 }, () => ({
      exercises: Array.from({ length: ROUTINE_LIMITS.exercisesPerStage + 3 }, () => ({
        repsMin: 5,
      })),
    }));
    const routine = parseRoutine("r", { name: "Mucho", createdAt: 1, stages: many });
    expect(routine?.stages).toHaveLength(ROUTINE_LIMITS.stages);
    expect(routine?.stages[0]!.exercises).toHaveLength(ROUTINE_LIMITS.exercisesPerStage);
  });

  it("reject data without a valid name or creation time", () => {
    expect(parseRoutine("r", { name: " ", createdAt: 1, stages: [] })).toBeNull();
    expect(parseRoutine("r", { name: "Ok", createdAt: "ayer", stages: [] })).toBeNull();
    expect(parseRoutine("r", null)).toBeNull();
  });

  it("still read lines written before links, with five fields", () => {
    expect(
      parseRoutine("r", { name: "Ok", createdAt: 1, stages: [{ exercises: "Remo\t10\t\t\t" }] })
        ?.stages,
    ).toEqual([{ exercises: [{ name: "Remo", repsMin: 10 }] }]);
  });

  it("drop a stored link that is not a safe https link", () => {
    expect(
      parseRoutine("r", {
        name: "Ok",
        createdAt: 1,
        stages: [{ exercises: "Remo\t\t\t\t\tjavascript:alert(1)" }],
      })?.stages,
    ).toEqual([{ exercises: [{ name: "Remo" }] }]);
  });

  it("keep a stored link to the local network to show and fix, but never store it again", () => {
    const stored = {
      name: "Ok",
      createdAt: 1,
      stages: [{ exercises: "Remo\t\t\t\t\thttps://192.168.0.1/video" }],
    };
    const routine = parseRoutine("r", stored);
    expect(routine?.stages).toEqual([
      { exercises: [{ name: "Remo", link: "https://192.168.0.1/video" }] },
    ]);
    expect(toStoredRoutine(routine!).stages).toEqual([{ exercises: "Remo\t\t\t\t\t" }]);
  });

  it("read malformed stages as no stages rather than failing", () => {
    expect(parseRoutine("r", { name: "Ok", createdAt: 1, stages: "x" })?.stages).toEqual([]);
    expect(
      parseRoutine("r", { name: "Ok", createdAt: 1, stages: [{ exercises: "\tnope\t\t\t" }] })
        ?.stages,
    ).toEqual([]);
  });
});

describe("received routines (T26, S12)", () => {
  const receivedFrom = { uid: "alice-uid", name: "Alice Liddell", email: "Alice@Example.com" };
  const received = { name: "Piernas", createdAt: 1, stages: [], receivedFrom };

  it("keep who sent them, uid included, through storage and in the outbox's shape", () => {
    expect(toStoredRoutine(received)).toEqual(received);
    expect(parseRoutine("r", toStoredRoutine(received))).toEqual({ id: "r", ...received });
    expect(parseRoutine("r", received)).toEqual({ id: "r", ...received });
  });

  it("keep an empty sender name, which shows the email alone", () => {
    const sender = { uid: "u", name: "", email: "a@b.co" };
    expect(parseRoutine("r", { ...received, receivedFrom: sender })?.receivedFrom).toEqual(sender);
  });

  it("keep a sender uid of up to 128 characters", () => {
    const sender = { uid: "u".repeat(ROUTINE_LIMITS.senderUidLength), name: "A", email: "a@b.co" };
    expect(ROUTINE_LIMITS.senderUidLength).toBe(128);
    expect(parseRoutine("r", { ...received, receivedFrom: sender })?.receivedFrom).toEqual(sender);
  });

  it("read a sender with an unusable name as one without a name", () => {
    for (const name of ["Ali\u0007ce", "N".repeat(ROUTINE_LIMITS.senderNameLength + 1), 5, null]) {
      expect(
        parseRoutine("r", { ...received, receivedFrom: { uid: "u", name, email: "a@b.co" } })
          ?.receivedFrom,
      ).toEqual({ uid: "u", name: "", email: "a@b.co" });
    }
  });

  it("keep the sender's Google photo, and leave out any other (T29 W3)", () => {
    const photo = "https://lh3.googleusercontent.com/a/alice=s96-c";
    const withPhoto = { ...received, receivedFrom: { ...receivedFrom, photo } };
    expect(toStoredRoutine(withPhoto)).toEqual(withPhoto);
    expect(parseRoutine("r", toStoredRoutine(withPhoto))).toEqual({ id: "r", ...withPhoto });
    for (const other of [
      "",
      "https://example.com/a.png",
      "https://googleusercontent.com.evil.co/a",
      "https://lh3.googleusercontent.com:443/a",
      `https://lh3.googleusercontent.com/${"p".repeat(500)}`,
      5,
      null,
    ]) {
      const routine = { ...received, receivedFrom: { ...receivedFrom, photo: other } };
      expect(parseRoutine("r", routine)?.receivedFrom, JSON.stringify(other)).toEqual(receivedFrom);
      expect(toStoredRoutine(routine as never).receivedFrom).toEqual(receivedFrom);
    }
  });

  it("keep any sender email a verified sign-in may hold: '/', spaces, a quoted @ (T29 W4)", () => {
    for (const email of [
      "a/b@example.com",
      '"al ice"@example.com',
      '"a@b"@example.com',
      "a\u00a0b@example.com",
    ]) {
      const sender = { uid: "u", name: "A", email };
      expect(isSenderEmail(email), email).toBe(true);
      expect(parseRoutine("r", { ...received, receivedFrom: sender })?.receivedFrom).toEqual(
        sender,
      );
    }
  });

  it("drop a sender without a usable email, keeping the routine", () => {
    for (const sender of [
      { uid: "u", name: "A", email: "nope" },
      { uid: "u", name: "A", email: "@b.co" },
      { uid: "u", name: "A", email: "a@" },
      { uid: "u", name: "A", email: "a\u0007b@c.d" },
      { uid: "u", name: "A", email: "a\nb@c.d" },
      { uid: "u", name: "A", email: "broken \uD800@c.d" },
      { uid: "u", name: "A", email: `${"a".repeat(ROUTINE_LIMITS.senderEmailLength)}@b.co` },
      { uid: "u", name: "A" },
      "Alice",
      null,
    ]) {
      const routine = parseRoutine("r", { ...received, receivedFrom: sender });
      expect(routine?.name).toBe("Piernas");
      expect(routine).not.toHaveProperty("receivedFrom");
    }
  });

  it("drop a sender without a usable uid, keeping the routine", () => {
    for (const uid of [
      undefined,
      "",
      "u".repeat(ROUTINE_LIMITS.senderUidLength + 1),
      "a/b",
      "a\u0007b",
      "a\nb",
      "a\u0085b",
      "broken \uD800 half",
      7,
      null,
    ]) {
      const routine = parseRoutine("r", {
        ...received,
        receivedFrom: { uid, name: "A", email: "a@b.co" },
      });
      expect(routine?.name, JSON.stringify(uid)).toBe("Piernas");
      expect(routine, JSON.stringify(uid)).not.toHaveProperty("receivedFrom");
    }
  });

  it("show the sender's name only when it has something visible", () => {
    const named = (name: string) => senderName({ uid: "u", name, email: "a@b.co" });
    expect(named("  Alice  ")).toBe("Alice");
    expect(named("")).toBeNull();
    expect(named("   ")).toBeNull();
    expect(named("\u202e\u200b")).toBeNull();
    expect(named("\u202eecilA")).toBe("\u202eecilA");
  });
});
