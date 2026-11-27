// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { DIRECTORY_LIMITS } from "../../directory/domain/directory";
import { ROUTINE_LIMITS, toStoredRoutine, type StoredStage } from "../../routines/domain/routine";
import { buildSharedCopy, storedCopyProblems, type SenderClaims } from "./sharedCopy";

/**
 * The app checks a copy before sending it with the same verdicts as the inbox rules
 * (isInboxCopy in firestore/firestore.rules). Every case here is one of
 * firestore/inbox.rules.test.ts, which runs it against the real rules on the emulator: what the
 * rules accept, the app accepts; what they refuse, the app refuses before writing.
 */

const L = ROUTINE_LIMITS;

const base = toStoredRoutine({
  name: "Empuje",
  notes: "Calentar bien.\nHombros primero.",
  createdAt: 1,
  stages: [
    {
      name: "Bloque A",
      notes: "Sin prisa.",
      exercises: [
        {
          name: "Press banca",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
          link: "https://www.youtube.com/watch?v=abc&t=1s",
        },
        { repsMin: 12 },
      ],
    },
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
});
const copy = { name: base.name, notes: base.notes, stages: base.stages };
const withStages = (stages: StoredStage[]) => ({ ...copy, stages });
const withStage = (stage: StoredStage) => withStages([stage]);
const withLines = (exercises: string) => withStage({ exercises });
const lineWithLink = (link: string) => `Remo\t10\t\t\t\t${link}`;

const accepts = (content: Parameters<typeof storedCopyProblems>[0], label = "") => {
  expect(storedCopyProblems(content), label).toEqual([]);
};
const refuses = (content: Parameters<typeof storedCopyProblems>[0], label = "") => {
  expect(storedCopyProblems(content), label).not.toEqual([]);
};

describe("what the inbox rules accept, the app accepts", () => {
  it("the copy of a routine the app stores", () => {
    accepts(copy);
    accepts({ name: "Empuje", stages: [] });
    accepts(withStage({ name: "Solo el nombre", exercises: "" }));
    accepts(withStage({ notes: "Solo notas", exercises: "" }));
  });

  it("every exercise field on its own, and ordered rep ranges", () => {
    for (const line of [
      "Remo\t\t\t\t\t",
      "\t10\t\t\t\t",
      "\t8-10\t\t\t\t",
      "\t9-10\t\t\t\t",
      "\t99-100\t\t\t\t",
      "\t998-999\t\t\t\t",
      "\t1-999\t\t\t\t",
      "\t109-110\t\t\t\t",
      "\t\t0\t\t\t",
      "\t\t3600\t\t\t",
      "\t\t\t0kg\t\t",
      "\t\t\t1000lb\t\t",
      "\t\t\t\tlento\t",
      "\t\t\t\t\thttps://youtu.be/abc",
      "a\t\t\t\t\t\nb\t\t\t\t\t",
    ]) {
      accepts(withLines(line), line);
    }
  });

  it("links to named sites: paths, queries, ports and a trailing dot", () => {
    for (const link of [
      "https://youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc&t=1s",
      "https://www.youtube.com/@canal",
      "https://www.instagram.com/p/C1a2b3c4d5/",
      "https://youtu.be/abc",
      "https://example.io:8443/x",
      "https://a-b.example.co.uk/p?q=1#h",
      "https://EXAMPLE.COM.",
      "https://xn--bcher-kva.de/x",
      "https://localhost.com/x",
      "https://local.example.org",
      "https://lan.party.net",
      "https://lana.app",
      "https://internals.dev",
      "https://123.example.com",
      "https://0xdead.beef.io",
      "https://3232235521.com",
      "https://localhost.example.com",
      "https://router.local.example.com:8443/x",
      "https://192.168.0.1.nip.io/",
      // Every port a browser opens (T29 W5).
      "https://x.com:0",
      "https://x.com:443/a",
      "https://x.com:00080",
      "https://x.com:9999",
      "https://x.com:59999",
      "https://x.com:64999",
      "https://x.com:65499",
      "https://x.com:65529",
      "https://x.com:65535",
    ]) {
      accepts(withLines(lineWithLink(link)), link);
      accepts(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`), link);
    }
  });

  it("the largest copy, multibyte text and texts starting with an emoji", () => {
    const longest = `https://x.com/${"e".repeat(L.linkLength - 14)}`;
    const largest = toStoredRoutine({
      name: "a".repeat(L.nameLength),
      notes: "n".repeat(L.notesLength),
      createdAt: 1,
      stages: Array.from({ length: L.stages }, () => ({
        name: "b".repeat(L.stageNameLength),
        notes: "m".repeat(L.notesLength),
        exercises: Array.from({ length: L.exercisesPerStage }, () => ({
          name: "c".repeat(L.exerciseNameLength),
          repsMin: L.reps.max - 1,
          repsMax: L.reps.max,
          restSeconds: L.restSeconds.max,
          weight: L.weight.max - 0.5,
          weightUnit: "lb" as const,
          notes: "d".repeat(L.exerciseNotesLength),
          link: longest,
        })),
      })),
    });
    accepts(largest);
    const e = "\u{1F4AA}";
    accepts(
      toStoredRoutine({
        name: e.repeat(20),
        notes: e.repeat(250),
        createdAt: 1,
        stages: [
          {
            name: e.repeat(20),
            notes: e.repeat(250),
            exercises: [{ name: e.repeat(20), notes: e.repeat(60), weight: 0 }],
          },
        ],
      }),
    );
    for (const t of ["\u{1F4AA} Piernas", "\u{1FAE8} Core"]) {
      accepts({ ...copy, name: t });
      accepts({ ...copy, notes: t });
      accepts(withStage({ name: t, exercises: "Remo\t\t\t\t\t" }));
      accepts(withStage({ notes: t, exercises: "Remo\t\t\t\t\t" }));
      accepts(withLines(`${t}\t\t\t\t\t`));
      accepts(withLines(`Remo\t\t\t\t${t}\t`));
    }
  });

  it("notes that look like a link, read as notes", () => {
    accepts(withLines("Remo\t\t\t\thttps://router/x\thttps://youtu.be/abc"));
    accepts(withLines("https://localhost/x\t\t\t\t\t"));
  });

  it("limits at their edge", () => {
    const line = "x\t\t\t\t\t";
    accepts(withLines(Array.from({ length: L.exercisesPerStage }, () => line).join("\n")));
    accepts(withStages(Array.from({ length: L.stages }, () => ({ exercises: line }))));
    accepts({ ...copy, name: "a".repeat(L.nameLength) });
    accepts({ ...copy, notes: "n".repeat(L.notesLength) });
  });
});

describe("what the inbox rules refuse, the app refuses", () => {
  const blanks = ["", " ", "   ", "\u3000", "\u00a0", "\u200b", "\u200b\u200c", "\ufeff"];

  it("blank or invisible names and notes", () => {
    for (const text of blanks) {
      refuses({ ...copy, name: text });
      refuses(withStage({ name: text, exercises: "Remo\t\t\t\t\t" }));
    }
    for (const notes of [...blanks, "\n", " \n "]) {
      refuses({ ...copy, notes });
      refuses(withStage({ notes, exercises: "Remo\t\t\t\t\t" }));
    }
    for (const text of blanks.slice(1)) {
      refuses(withLines(`${text}\t10\t\t\t\t`));
      refuses(withLines(`Remo\t\t\t\t${text}\t`));
    }
  });

  it("texts with nothing the app shows (L56)", () => {
    for (const t of [
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
      "\u2066\u2069",
      "\u061c",
      "\u08e2",
      "\u0890",
      "\u{110cd}",
      "\u{13430}",
      "\u{1bca0}",
      "\u2065",
      "\u{e0080}",
      "\ufffe",
    ]) {
      refuses({ ...copy, name: t });
      refuses({ ...copy, notes: t });
      refuses(withStage({ name: t, exercises: "Remo\t\t\t\t\t" }));
      refuses(withStage({ notes: t, exercises: "Remo\t\t\t\t\t" }));
      refuses(withLines(`${t}\t\t\t\t\t`));
      refuses(withLines(`Remo\t\t\t\t${t}\t`));
    }
  });

  it("a stage with nothing in it", () => {
    refuses(withStage({ exercises: "" }));
    refuses(withStages([...copy.stages, { exercises: "" }]));
  });

  it("reversed or equal rep ranges", () => {
    for (const reps of [
      "10-8",
      "10-10",
      "2-1",
      "1-1",
      "999-1",
      "100-99",
      "21-12",
      "110-109",
      "999-999",
      "100-9",
    ]) {
      refuses(withLines(`\t${reps}\t\t\t\t`), reps);
      refuses(withLines(`a\t\t\t\t\t\nRemo\t${reps}\t90\t\t\t`), reps);
    }
  });

  it("an empty exercise line, wherever it is", () => {
    for (const exercises of [
      "\t\t\t\t\t",
      "a\t\t\t\t\t\n\t\t\t\t\t",
      "\t\t\t\t\t\na\t\t\t\t\t",
      "a\t\t\t\t\t\n\t\t\t\t\t\nb\t\t\t\t\t",
      "a\t\t\t\t\t\n",
      "\na\t\t\t\t\t",
      "a\t\t\t\t\t\n\nb\t\t\t\t\t",
      "\n",
    ]) {
      refuses(withLines(exercises), JSON.stringify(exercises));
    }
  });

  it("malformed exercise lines", () => {
    for (const line of [
      "Remo\t\t\t\t",
      "Remo\t\t\t\t\t\t",
      "\t0\t\t\t\t",
      "\t010\t\t\t\t",
      "\t8 - 10\t\t\t\t",
      "\t\t1:30\t\t\t",
      "\t\t0900\t\t\t",
      "\t\t\t60\t\t",
      "\t\t\t60KG\t\t",
      "\t\t\t62.55kg\t\t",
      "a\u0007b\t\t\t\t\t",
      "a\t\t\t\t\t\r\nb\t\t\t\t\t",
      "a\t\t\t\t\thttps://u@x.com",
    ]) {
      refuses(withLines(line), JSON.stringify(line));
    }
  });

  it("every limit: stages, exercises, lengths and numbers", () => {
    const line = "x\t\t\t\t\t";
    refuses(withLines(Array.from({ length: L.exercisesPerStage + 1 }, () => line).join("\n")));
    refuses(withStages(Array.from({ length: L.stages + 1 }, () => ({ exercises: line }))));
    refuses({ ...copy, name: "a".repeat(L.nameLength + 1) });
    refuses({ ...copy, notes: "n".repeat(L.notesLength + 1) });
    refuses(withStage({ name: "b".repeat(L.stageNameLength + 1), exercises: line }));
    refuses(withStage({ notes: "m".repeat(L.notesLength + 1), exercises: line }));
    refuses(withLines(`${"c".repeat(L.exerciseNameLength + 1)}\t\t\t\t\t`));
    refuses(withLines(`\t\t\t\t${"d".repeat(L.exerciseNotesLength + 1)}\t`));
    refuses(withLines(`\t${L.reps.max + 1}\t\t\t\t`));
    refuses(withLines(`\t1-${L.reps.max + 1}\t\t\t\t`));
    refuses(withLines(`\t\t${L.restSeconds.max + 1}\t\t\t`));
    refuses(withLines(`\t\t\t${L.weight.max + 0.5}kg\t\t`));
    refuses(withLines(lineWithLink(`https://${"e".repeat(L.linkLength)}.com`)));
    refuses(withLines(lineWithLink(`https://x.com/${"e".repeat(L.linkLength)}`)));
  });

  it("links to the local network, disguised hosts, non-ASCII hosts and bad hosts or ports", () => {
    for (const link of [
      // Local or IP (T23, L51, L53).
      "https://localhost",
      "https://LocalHost:5173/x",
      "https://app.localhost",
      "https://localhost.",
      "https://192.168.0.1",
      "https://8.8.8.8",
      "https://192.168.0.1:8080/admin",
      "https://8.8.8.8.",
      "https://3232235521",
      "https://0xC0A80001",
      "https://0xc0a80001/x",
      "https://0xC0.0250.0.1",
      "https://0300.0250.0.1",
      "https://127.1",
      "https://10.1.1",
      "https://[::1]",
      "https://[2001:db8::1]:8443/x",
      "https://[::ffff:192.168.0.1]",
      "https://router",
      "https://router:8080/admin",
      "https://router.",
      "https://www",
      "https://nas.local",
      "https://NAS.LOCAL/fotos",
      "https://printer.lan",
      "https://db.internal:8443",
      "https://box.home.arpa",
      "https://box.Home.Arpa.",
      "https://nas\u3002local",
      "https://192\uff0e168\uff0e0\uff0e1",
      "https://192.168.0.1./",
      "https://0XC0A80001",
      "https://LOCALHOST",
      "https://LOCALHOST.:443",
      "https://printer.LOCAL",
      "https://a.home.arpa./",
      "https://127.1:80",
      "https://4294967295",
      // Disguised (L53 A1).
      "https://\uff11\uff19\uff12\uff0e\uff11\uff16\uff18\uff0e\uff10\uff0e\uff11",
      "https://\uff52\uff4f\uff55\uff54\uff45\uff52\uff0e\uff4c\uff4f\uff43\uff41\uff4c",
      "https://a.\u24db\u24d0\u24dd",
      "https://192.168.0\u2488",
      "https://127.0.0.\uff11",
      "https://app.\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54",
      "https://nas.\uff4c\uff41\uff4e",
      "https://db.\uff49\uff4e\uff54\uff45\uff52\uff4e\uff41\uff4c",
      "https://box.\uff48\uff4f\uff4d\uff45.\uff41\uff52\uff50\uff41",
      "https://192.168.0.\u2460",
      "https://192.168.0\ufe521",
      "https://\u{1d7cf}\u{1d7d7}\u{1d7d0}.\u{1d7cf}\u{1d7d4}\u{1d7d6}.\u{1d7ce}.\u{1d7cf}",
      "https://x.\u24db\u24de\u24d2\u24d0\u24db",
      "https://1.0x\uff430",
      "https://192.168.0.%31",
      "https://you%2Ecom",
      "https://192%2E168%2E0%2E1",
      // Other non-ASCII hosts, even of a named site: a copy holds them in punycode.
      "https://youtube\u3002com",
      "https://youtube\uff0ecom",
      "https://b\u00fccher.de",
      "https://example.co\u212a",
      "https://example.\u017fite",
      "https://\u0430pple.com",
      // Top-level names.
      "https://a.0xg",
      "https://example.c0m",
      "https://example.c",
      "https://example.-com",
      "https://in-addr.arpa",
      "https://x.ARPA",
      // Not https, credentials, spaces, bad host or port.
      "http://x.com",
      "javascript:alert(1)",
      "HTTPS://X.COM",
      "https://user:pw@x.com",
      "https://@x.com",
      "https:// x.com",
      "https://x.com/a b",
      "https://x.com/a\u00a0b",
      "https://x.com/a\u200bb",
      "https://",
      "https:///x",
      "https://.com",
      "https://-x.com",
      "https://www.",
      "https://x.com:abc",
      "https://x.com:123456",
      "https://x.com:65536",
      "https://x.com:70000",
      "https://x.com:99999",
      "https://x_y.com",
    ]) {
      refuses(withLines(lineWithLink(link)), link);
      refuses(withLines(`a\t\t\t\t\thttps://x.com\n${lineWithLink(link)}`), link);
    }
  });
});

describe("the sender, as the inbox rules bind it to the sign-in", () => {
  const routine = {
    name: "Empuje",
    createdAt: 1,
    stages: [{ exercises: [{ name: "Remo" }] }],
  };
  const alice: SenderClaims = {
    uid: "alice",
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice Liddell",
    picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
  };
  const fromOf = (claims: SenderClaims) => {
    const result = buildSharedCopy(routine, claims);
    return "copy" in result ? result.copy : null;
  };

  it("takes the uid, email, name and photo of the sign-in exactly", () => {
    expect(fromOf(alice)).toMatchObject({
      fromUid: "alice",
      fromEmail: "alice@example.com",
      fromName: "Alice Liddell",
      fromPhoto: alice.picture,
    });
  });

  it("an empty name when the sign-in has none; no photo when it has none", () => {
    const copy = fromOf({ ...alice, name: undefined, picture: undefined });
    expect(copy?.fromName).toBe("");
    expect(copy && "fromPhoto" in copy).toBe(false);
  });

  it("no photo that is not on googleusercontent.com, nor a look-alike", () => {
    for (const picture of [
      "https://example.com/alice.png",
      "https://googleusercontent.com.evil.com/a",
      "https://lh3.googleusercontent.com@evil.com/a",
      "https://evilgoogleusercontent.com/a",
      "https://lh3.googleusercontent.com:443/a",
      "http://lh3.googleusercontent.com/a",
    ]) {
      const copy = fromOf({ ...alice, picture });
      expect(copy && "fromPhoto" in copy, picture).toBe(false);
    }
  });

  it("refuses to send with a name the rules refuse, or an unverified or missing email", () => {
    for (const name of ["N".repeat(DIRECTORY_LIMITS.nameLength + 1), "Alice\nLiddell"]) {
      expect(fromOf({ ...alice, name })).toBeNull();
    }
    expect(fromOf({ ...alice, emailVerified: false })).toBeNull();
    expect(fromOf({ ...alice, email: undefined })).toBeNull();
  });
});
