import { expect, test as base, type Locator, type Page } from "@playwright/test";
import {
  type Account,
  accountExists,
  addContact,
  clearEmulatorData,
  contactOf,
  deleteAccount,
  eventually,
  listedAccount,
  listMe,
  newAccount,
  openContacts,
  openedPage,
  openTab,
  queuedWrites,
  signInAs,
  signOut,
  startButton,
  stored,
  storedContacts,
  writeStored,
} from "./helpers";

/** Two people on two browsers: Ana on the test's page, Beto on a page of his own browser. */
const test = base.extend<{ betoPage: Page }>({
  betoPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(await context.newPage());
    await context.close();
  },
});

test.beforeEach(clearEmulatorData);
// Two signed-in browsers and several trips to the server each: generous for a slow machine.
test.describe.configure({ timeout: 300_000 });

// ---------------------------------------------------------------------------------------------
// What the server holds

/** Each routine as the server holds it: name, notes, sender and stages (exercise lines as stored). */
const storedRoutines = async (uid: string) =>
  (await stored(uid, "routines")).map(({ name, fields }) => {
    const sender = fields.receivedFrom?.mapValue?.fields;
    return {
      id: name.split("/").pop(),
      name: fields.name?.stringValue,
      notes: fields.notes?.stringValue,
      receivedFrom: sender && {
        uid: sender.uid?.stringValue,
        name: sender.name?.stringValue,
        email: sender.email?.stringValue,
      },
      stages: (fields.stages?.arrayValue?.values ?? []).map((stage) => ({
        name: stage.mapValue?.fields?.name?.stringValue,
        notes: stage.mapValue?.fields?.notes?.stringValue,
        exercises: stage.mapValue?.fields?.exercises?.stringValue,
      })),
    };
  });

const routineNames = async (uid: string) => (await storedRoutines(uid)).map(({ name }) => name);

/** Who the account blocked, as the server holds them. */
const storedBlocked = async (uid: string) =>
  (await stored(uid, "blocked")).map(({ name, fields }) => ({
    id: name.split("/").pop(),
    name: fields.name?.stringValue,
    email: fields.email?.stringValue,
  }));

// ---------------------------------------------------------------------------------------------
// Routines, as the user writes them

interface ExerciseInput {
  name: string;
  reps?: string;
  rest?: string;
  weight?: string;
  unit?: "kg" | "lb";
  notes?: string;
  link?: string;
}

interface RoutineInput {
  name: string;
  notes?: string;
  stages: { name?: string; notes?: string; exercises: ExerciseInput[] }[];
}

const INTERNATIONAL_LINK = "https://bücher.de/libro";
/** The same link with its host in ASCII (punycode), as a shared copy holds it. */
const INTERNATIONAL_LINK_ASCII = "https://xn--bcher-kva.de/libro";

/** Two stages, with every kind of field: reps range, rest, weight, notes and two links. */
const fullRoutine = (name: string): RoutineInput => ({
  name,
  notes: "Calentar 10 minutos",
  stages: [
    {
      name: "Piernas",
      notes: "Sin pausa entre ejercicios",
      exercises: [
        {
          name: "Sentadilla",
          reps: "8 - 10",
          rest: "90",
          weight: "62.5",
          notes: "Bajar lento",
          link: "https://www.youtube.com/watch?v=abc123",
        },
        { name: "Prensa", reps: "12", link: INTERNATIONAL_LINK },
      ],
    },
    {
      name: "Empuje",
      exercises: [{ name: "Press banca", reps: "6 - 8", rest: "1:30", weight: "40", unit: "lb" }],
    },
  ],
});

const simpleRoutine = (name: string): RoutineInput => ({
  name,
  stages: [{ exercises: [{ name: "Dominadas", reps: "5" }] }],
});

/** The bidi controls the app takes out of a text it isolates (L65). */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

/** Text another user wrote, isolated as the app puts it in accessible names and messages. */
const iso = (text: string) => `\u2068${text.replace(BIDI_CONTROLS, "")}\u2069`;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------
// Screens

const routinesItem = (page: Page) => page.getByRole("button", { name: /^Routines/ });
const routineList = (page: Page) => page.getByRole("list", { name: "Routines" });
/** A routine's button in the list, marked New or not. */
const listedRoutine = (page: Page, name: string) =>
  routineList(page).getByRole("button", {
    name: new RegExp(`^Open ${escaped(iso(name))}(, new)?$`),
  });
const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true });

async function openRoutines(page: Page) {
  await openTab(page, "Profile");
  await routinesItem(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
}

/** Opens a routine's view from the Routines list. */
async function openRoutine(page: Page, name: string) {
  await listedRoutine(page, name).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
}

/** Creates a routine from the Routines screen and comes back to the list. */
async function createRoutine(page: Page, routine: RoutineInput) {
  await page.getByRole("button", { name: "New routine" }).click();
  await page.getByRole("textbox", { name: "Routine name" }).fill(routine.name);
  if (routine.notes !== undefined) {
    await page.getByRole("textbox", { name: "Notes", exact: true }).fill(routine.notes);
  }
  for (const [stageIndex, stage] of routine.stages.entries()) {
    await page.getByRole("button", { name: "Add stage" }).click();
    // Named by its position until it gets a name, so the name is written last.
    const group = page.getByRole("group", { name: `Stage ${stageIndex + 1}`, exact: true });
    for (const [index, exercise] of stage.exercises.entries()) {
      if (index > 0) await group.getByRole("button", { name: "Add exercise" }).click();
      const row = group.getByRole("group", { name: `Exercise ${index + 1}`, exact: true });
      await row.getByRole("textbox", { name: "Exercise name" }).fill(exercise.name);
      if (exercise.reps) await row.getByRole("textbox", { name: "Reps" }).fill(exercise.reps);
      if (exercise.rest) await row.getByRole("textbox", { name: "Rest" }).fill(exercise.rest);
      if (exercise.weight) {
        await row.getByRole("textbox", { name: "Weight", exact: true }).fill(exercise.weight);
      }
      if (exercise.unit) await row.getByRole("button", { name: exercise.unit }).click();
      if (exercise.notes) {
        await row.getByRole("textbox", { name: "Exercise notes" }).fill(exercise.notes);
      }
      if (exercise.link) await row.getByRole("textbox", { name: "Link" }).fill(exercise.link);
    }
    if (stage.notes) await group.getByRole("textbox", { name: "Stage notes" }).fill(stage.notes);
    if (stage.name) await group.getByRole("textbox", { name: "Stage name" }).fill(stage.name);
  }
  await page.getByRole("button", { name: "Save routine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
}

/** From a routine's view: Share, pick the recipient, Continue, and confirm with Send. */
async function shareTo(page: Page, routineName: string, recipient: Account) {
  await page.getByRole("button", { name: `Share ${iso(routineName)}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Share routine" })).toBeVisible();
  await page.getByRole("checkbox", { name: iso(recipient.name), exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: `Send "${iso(routineName)}" to ${iso(recipient.name)}?`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** The recipient's line in the share results. */
const resultFor = (page: Page, { name }: Account) =>
  page.getByRole("list", { name: "Result" }).getByRole("listitem").filter({ hasText: name });

/** What a routine's view shows: its title, stage titles and every table, as text. */
async function viewContent(page: Page) {
  return {
    title: await page.getByRole("heading", { level: 1 }).innerText(),
    stages: await page.getByRole("heading", { level: 2 }).allInnerTexts(),
    tables: await page.getByRole("table").allInnerTexts(),
  };
}

/** The "View" button of an exercise's link, in the row of that exercise. */
const linkOf = (page: Page, exercise: string) =>
  page.getByRole("row").filter({ hasText: exercise }).getByRole("link");
const hostOf = (link: Locator) => link.evaluate((anchor: HTMLAnchorElement) => anchor.host);

const receivedLine = (from: Account) => `Received from ${iso(from.name)} (${iso(from.email)})`;

/**
 * Beto lets people find him by email and stays signed in on his page; Ana signs in on hers and
 * adds him as a contact.
 */
async function anaAndBeto(page: Page, betoPage: Page) {
  const beto = await newAccount(await openedPage(betoPage), "beto");
  await listMe(betoPage, beto);
  const ana = await newAccount(await openedPage(page), "ana");
  await openContacts(page);
  await addContact(page, beto.email);
  await eventually(() => storedContacts(ana.uid)).toEqual([contactOf(beto)]);
  return { ana, beto };
}

/** Ana creates a routine, opens it and sends it to Beto, who has it on the server. */
async function sendReceived(page: Page, routine: RoutineInput, beto: Account) {
  await openRoutines(page);
  await createRoutine(page, routine);
  await openRoutine(page, routine.name);
  await shareTo(page, routine.name, beto);
  await expect(resultFor(page, beto)).toContainText("Sent.", { timeout: 60_000 });
  await eventually(() => routineNames(beto.uid)).toContain(routine.name);
}

// ---------------------------------------------------------------------------------------------

test("a routine shared with a contact arrives by itself, marked received and new, with the same content", async ({
  page,
  betoPage,
}) => {
  const { ana, beto } = await anaAndBeto(page, betoPage);
  const routine = fullRoutine("Pierna y empuje");
  await openRoutines(page);
  await createRoutine(page, routine);
  await eventually(() => routineNames(ana.uid)).toEqual([routine.name]);
  const [own] = await storedRoutines(ana.uid);
  // The original keeps the link as typed: only the copy holds it in ASCII.
  expect(own?.stages[0]?.exercises).toContain(INTERNATIONAL_LINK);

  // Beto waits on Profile, with nothing new yet.
  await openTab(betoPage, "Profile");
  await expect(routinesItem(betoPage)).toHaveAccessibleName("Routines");

  await openRoutine(page, routine.name);
  await expect(page.getByText(routine.notes ?? "", { exact: true })).toBeVisible();
  const sent = await viewContent(page);
  const ownHost = await hostOf(linkOf(page, "Prensa"));
  await shareTo(page, routine.name, beto);
  await expect(resultFor(page, beto)).toContainText("Sent.", { timeout: 60_000 });

  // It arrives by itself and is counted on Profile.
  await expect(routinesItem(betoPage)).toHaveAccessibleName("Routines, 1 new routine", {
    timeout: 60_000,
  });
  await expect(routinesItem(betoPage)).toHaveText("Routines · 1 new");

  // On the server: among Beto's routines, marked from Ana, with the link in ASCII, and no longer
  // in his inbox.
  await eventually(() => routineNames(beto.uid)).toEqual([routine.name]);
  await eventually(() => stored(beto.uid, "inbox")).toEqual([]);
  expect(await storedRoutines(beto.uid)).toEqual([
    {
      id: expect.any(String),
      name: routine.name,
      notes: routine.notes,
      receivedFrom: { uid: ana.uid, name: ana.name, email: ana.email },
      stages: own?.stages.map((stage) => ({
        ...stage,
        exercises: stage.exercises?.replace(INTERNATIONAL_LINK, INTERNATIONAL_LINK_ASCII),
      })),
    },
  ]);

  await routinesItem(betoPage).click();
  const listed = routineList(betoPage).getByRole("button", {
    name: `Open ${iso(routine.name)}, new`,
    exact: true,
  });
  await expect(listed).toBeVisible();
  await expect(listed).toHaveAccessibleDescription(receivedLine(ana));
  await expect(listed.getByText("New", { exact: true })).toBeVisible();

  await listed.click();
  await expect(betoPage.getByRole("heading", { level: 1 })).toHaveText(routine.name);
  await expect(betoPage.getByText(receivedLine(ana))).toBeVisible();
  await expect(betoPage.getByText(routine.notes ?? "", { exact: true })).toBeVisible();
  await expect(betoPage.getByText("Sin pausa entre ejercicios", { exact: true })).toBeVisible();
  expect(await viewContent(betoPage)).toEqual(sent);

  // The international link opens the same site, from its ASCII form.
  const link = linkOf(betoPage, "Prensa");
  await expect(link).toHaveText("View");
  await expect(link).toHaveAttribute("href", INTERNATIONAL_LINK_ASCII);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAccessibleName(`View xn--bcher-kva.de (${iso("Prensa")})`);
  expect(await hostOf(link)).toBe(ownHost);
  expect(ownHost).toBe(new URL(INTERNATIONAL_LINK).host);

  // Seen: once Beto leaves Routines, it is no longer new.
  await back(betoPage).click();
  await expect(betoPage.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
  await back(betoPage).click();
  await expect(routinesItem(betoPage)).toHaveAccessibleName("Routines");
  await expect(routinesItem(betoPage)).toHaveText("Routines");
  await routinesItem(betoPage).click();
  await expect(
    routineList(betoPage).getByRole("button", { name: `Open ${iso(routine.name)}`, exact: true }),
  ).toBeVisible();
  await expect(routineList(betoPage).getByText("New", { exact: true })).toHaveCount(0);

  // Known limit (L67): "seen" is kept on this device and erased on sign-out, so it is new again.
  await signOut(betoPage);
  await signInAs(betoPage, beto.name);
  await openTab(betoPage, "Profile");
  await expect(routinesItem(betoPage)).toHaveAccessibleName("Routines, 1 new routine", {
    timeout: 60_000,
  });
});

test("a received copy is independent: later edits by either side change only their own", async ({
  page,
  betoPage,
}) => {
  const { ana, beto } = await anaAndBeto(page, betoPage);
  const routine = simpleRoutine("Tirón");
  await sendReceived(page, routine, beto);
  const [received] = await storedRoutines(beto.uid);

  // Ana edits hers.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: `Edit ${iso(routine.name)}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit routine" })).toBeVisible();
  await page.getByRole("textbox", { name: "Routine name" }).fill("Tirón B");
  await page.getByRole("textbox", { name: "Reps" }).fill("6 - 8");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tirón B");
  await eventually(() => routineNames(ana.uid)).toEqual(["Tirón B"]);
  const [anaEdited] = await storedRoutines(ana.uid);
  expect(anaEdited?.stages[0]?.exercises).toBe("Dominadas\t6-8\t\t\t\t");

  expect(await storedRoutines(beto.uid)).toEqual([received]);
  await openRoutines(betoPage);
  await expect(listedRoutine(betoPage, routine.name)).toBeVisible();

  // Beto edits his copy, which stays marked as received.
  await routineList(betoPage)
    .getByRole("button", { name: `Edit ${iso(routine.name)}`, exact: true })
    .click();
  await betoPage.getByRole("textbox", { name: "Routine name" }).fill("Tirón de Beto");
  await betoPage.getByRole("button", { name: "Save changes" }).click();
  await expect(listedRoutine(betoPage, "Tirón de Beto")).toBeVisible();
  await eventually(() => storedRoutines(beto.uid)).toEqual([
    { ...received, name: "Tirón de Beto" },
  ]);

  expect(await storedRoutines(ana.uid)).toEqual([anaEdited]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tirón B");
});

test("only contacts can be picked, and a refused or offline share writes nothing", async ({
  page,
  betoPage,
}) => {
  // Carla can be found by email, but Ana never adds her.
  const carla = await listedAccount(await openedPage(betoPage), "carla");
  const beto = await newAccount(betoPage, "beto");
  await listMe(betoPage, beto);
  const ana = await newAccount(await openedPage(page), "ana");

  // With no contacts, there is nobody to pick.
  const good = simpleRoutine("Hombros");
  await openRoutines(page);
  await createRoutine(page, good);
  await openRoutine(page, good.name);
  await page.getByRole("button", { name: `Share ${iso(good.name)}`, exact: true }).click();
  await expect(
    page.getByText("You have no contacts yet. Add them in Contacts to share routines."),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.getByRole("button", { name: "Go to Contacts" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
  await addContact(page, beto.email);
  await eventually(() => storedContacts(ana.uid)).toEqual([contactOf(beto)]);

  // Only the saved contacts are offered.
  await openRoutines(page);
  await openRoutine(page, good.name);
  await page.getByRole("button", { name: `Share ${iso(good.name)}`, exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: iso(beto.name), exact: true })).toBeVisible();
  await expect(page.getByText(carla.name)).toHaveCount(0);
  await back(page).click();
  await back(page).click();

  // A routine the copy rules refuse: the problems are listed and nothing is sent.
  const refused: RoutineInput = {
    name: "Con problema",
    stages: [
      { exercises: [{ name: "Remo", reps: "10", link: "https://mi_sitio.example.com/video" }] },
    ],
  };
  await createRoutine(page, refused);
  await openRoutine(page, refused.name);
  await shareTo(page, refused.name, beto);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("This routine can't be shared yet:");
  await expect(alert.getByRole("listitem")).toHaveText([
    `Check the link of exercise "${iso("Remo")}" of stage 1: it must be a website address that can be shared, with no underscores, a valid port and a real domain ending.`,
  ]);
  await expect(page.getByRole("list", { name: "Result" })).toHaveCount(0);
  expect(await stored(beto.uid, "inbox")).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).click();
  await back(page).click();
  await back(page).click();

  // Offline: said at once, and nothing waits to be sent.
  await eventually(() => routineNames(ana.uid)).toHaveLength(2);
  await expect.poll(() => queuedWrites(page)).toBe(0);
  await openRoutine(page, good.name);
  await page.context().setOffline(true);
  await shareTo(page, good.name, beto);
  await expect(page.getByText(/need a connection to share/)).toBeVisible({ timeout: 60_000 });
  expect(await queuedWrites(page)).toBe(0);
  expect(await stored(beto.uid, "inbox")).toEqual([]);
  expect(await storedRoutines(beto.uid)).toEqual([]);

  // Back online, the same share goes through, and it is the only routine Beto ever gets.
  await page.context().setOffline(false);
  await page.getByRole("button", { name: /^(Send|Try again)$/ }).click();
  await expect(resultFor(page, beto)).toContainText("Sent.", { timeout: 60_000 });
  await eventually(() => routineNames(beto.uid)).toEqual([good.name]);
  await eventually(() => stored(beto.uid, "inbox")).toEqual([]);
  expect(await routineNames(beto.uid)).toEqual([good.name]);
});

test("a blocked sender's routines are refused without saying why, until unblocked", async ({
  page,
  betoPage,
}) => {
  const { ana, beto } = await anaAndBeto(page, betoPage);
  const routine = simpleRoutine("Espalda");
  await sendReceived(page, routine, beto);

  // Beto blocks Ana from the routine she sent.
  await openRoutines(betoPage);
  await openRoutine(betoPage, routine.name);
  await betoPage
    .getByRole("button", { name: `Block ${iso(ana.name)} (${iso(ana.email)})`, exact: true })
    .click();
  const dialog = betoPage.getByRole("alertdialog");
  await expect(dialog).toHaveAccessibleName(`Block ${iso(ana.name)} (${iso(ana.email)})?`);
  await dialog.getByRole("button", { name: "Block", exact: true }).click();
  await expect(
    betoPage.getByText(
      `You blocked ${iso(ana.name)} (${iso(ana.email)}): they can't send you routines.`,
    ),
  ).toBeVisible();
  await eventually(() => storedBlocked(beto.uid)).toEqual([
    { id: ana.uid, name: ana.name, email: ana.email },
  ]);

  // Ana sends again: refused like any other refusal, never saying she was blocked.
  await page.getByRole("button", { name: "Done" }).click();
  await shareTo(page, routine.name, beto);
  await expect(resultFor(page, beto)).toContainText(
    "Not sent: the server refused it. Check they are still in your contacts.",
    { timeout: 60_000 },
  );
  await expect(page.locator("body")).not.toContainText(/block/i);
  expect(await stored(beto.uid, "inbox")).toEqual([]);
  expect(await routineNames(beto.uid)).toEqual([routine.name]);

  // Beto finds her in his blocked list, from Contacts, and unblocks her.
  await openContacts(betoPage);
  await betoPage.getByRole("button", { name: "Blocked", exact: true }).click();
  await expect(betoPage.getByRole("heading", { level: 1, name: "Blocked" })).toBeVisible();
  const blockedRow = betoPage
    .getByRole("list", { name: "Blocked" })
    .getByRole("listitem")
    .filter({ hasText: ana.name });
  await expect(blockedRow.getByText(ana.name, { exact: true })).toBeVisible();
  await expect(blockedRow.getByText(ana.email, { exact: true })).toBeVisible();
  await blockedRow.getByRole("button", { name: `Unblock ${iso(ana.name)}`, exact: true }).click();
  await expect(betoPage.getByText(/^You haven't blocked anyone\./)).toBeVisible();
  await eventually(() => storedBlocked(beto.uid)).toEqual([]);

  // Ana's next share is received.
  await page.getByRole("button", { name: "Done" }).click();
  await shareTo(page, routine.name, beto);
  await expect(resultFor(page, beto)).toContainText("Sent.", { timeout: 60_000 });
  await eventually(() => routineNames(beto.uid)).toEqual([routine.name, routine.name]);
  await eventually(() => stored(beto.uid, "inbox")).toEqual([]);
});

test("a deleted received routine stays deleted; deleting the account removes the inbox and blocked list", async ({
  page,
  betoPage,
}) => {
  const { ana, beto } = await anaAndBeto(page, betoPage);
  const routine = simpleRoutine("Core");
  await sendReceived(page, routine, beto);

  // A blocked sender, so the account has a blocked list to remove.
  await openRoutines(betoPage);
  await openRoutine(betoPage, routine.name);
  await betoPage
    .getByRole("button", { name: `Block ${iso(ana.name)} (${iso(ana.email)})`, exact: true })
    .click();
  await betoPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Block", exact: true })
    .click();
  await eventually(() => storedBlocked(beto.uid)).toHaveLength(1);

  await back(betoPage).click();
  await routineList(betoPage)
    .getByRole("button", { name: `Delete ${iso(routine.name)}`, exact: true })
    .click();
  await betoPage
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(betoPage.getByText(/^No routines yet/)).toBeVisible();
  await eventually(() => storedRoutines(beto.uid)).toEqual([]);
  expect(await stored(beto.uid, "inbox")).toEqual([]);

  await betoPage.reload();
  await expect(startButton(betoPage)).toBeVisible();
  await openRoutines(betoPage);
  await expect(betoPage.getByText(/^No routines yet/)).toBeVisible();
  expect(await storedRoutines(beto.uid)).toEqual([]);

  // A copy the app cannot read stays in the inbox (L62), so only deleting the account removes it.
  await writeStored(`users/${beto.uid}/inbox/unreadable`, {
    fromUid: "someone-else",
    name: "Not a routine",
  });
  expect(await stored(beto.uid, "inbox")).toHaveLength(1);

  await deleteAccount(betoPage);
  expect(await accountExists(beto.uid)).toBe(false);
  expect(await stored(beto.uid, "inbox")).toEqual([]);
  expect(await storedBlocked(beto.uid)).toEqual([]);
  expect(await storedRoutines(beto.uid)).toEqual([]);
});

test("bidi controls in a received routine's name never reorder the recipient's labels", async ({
  page,
  betoPage,
}) => {
  const { beto } = await anaAndBeto(page, betoPage);
  const name = "Piernas\u2069\u202e";
  // The controls reach Beto as written, so the checks below have something to isolate.
  await sendReceived(page, simpleRoutine(name), beto);
  expect(await routineNames(beto.uid)).toEqual([name]);

  await openRoutines(betoPage);
  const [opener, editor, deleter] = await Promise.all(
    ["Open", "Edit", "Delete"].map(async (verb) => {
      const button = routineList(betoPage).getByRole("button", { name: new RegExp(`^${verb} `) });
      return button.getAttribute("aria-label");
    }),
  );
  expect(opener).toBe(`Open ${iso("Piernas")}, new`);
  expect(editor).toBe(`Edit ${iso("Piernas")}`);
  expect(deleter).toBe(`Delete ${iso("Piernas")}`);

  await routineList(betoPage)
    .getByRole("button", { name: /^Delete / })
    .click();
  const dialog = betoPage.getByRole("alertdialog");
  await expect(dialog).toHaveAccessibleName(`Delete "${iso("Piernas")}"?`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await openRoutine(betoPage, name);
  const [share, remove] = await Promise.all([
    betoPage.getByRole("button", { name: /^Share / }).getAttribute("aria-label"),
    betoPage.getByRole("button", { name: /^Delete / }).getAttribute("aria-label"),
  ]);
  expect(share).toBe(`Share ${iso("Piernas")}`);
  expect(remove).toBe(`Delete ${iso("Piernas")}`);
  await betoPage.getByRole("button", { name: /^Delete / }).click();
  await expect(betoPage.getByRole("alertdialog")).toHaveAccessibleName(
    `Delete "${iso("Piernas")}"?`,
  );
});
