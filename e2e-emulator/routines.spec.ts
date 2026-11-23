import { expect, test, type Page } from "@playwright/test";
import { clearEmulatorData, eventually, openTab, signIn, stored } from "./helpers";

test.beforeEach(clearEmulatorData);

/** What the server holds for each routine: its id, name, creation time and stages' exercises. */
const storedRoutines = async (uid: string) =>
  (await stored(uid, "routines")).map(({ name, fields }) => ({
    id: name,
    name: fields.name?.stringValue,
    createdAt: fields.createdAt?.integerValue,
    exercises: (fields.stages?.arrayValue?.values ?? []).map(
      (stage) => stage.mapValue?.fields?.exercises?.stringValue,
    ),
  }));

async function openRoutines(page: Page) {
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Routines", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
}

/** Creates a routine with one stage holding a bench press, from the Routines screen. */
async function createRoutine(page: Page, name: string) {
  await page.getByRole("button", { name: "New routine" }).click();
  await page.getByRole("textbox", { name: "Routine name" }).fill(name);
  await page.getByRole("button", { name: "Add stage" }).click();
  const exercise = page
    .getByRole("group", { name: "Stage 1" })
    .getByRole("group", { name: "Exercise 1" });
  await exercise.getByRole("textbox", { name: "Exercise name" }).fill("Press banca");
  await exercise.getByRole("textbox", { name: "Reps" }).fill("8 - 10");
  await exercise.getByRole("textbox", { name: "Rest" }).fill("90");
  await exercise.getByRole("textbox", { name: "Weight" }).fill("62,5");
  await expect(exercise.getByRole("button", { name: "kg" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Save routine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Routines" })).toBeVisible();
}

const listed = (page: Page, name: string) =>
  page.getByRole("list", { name: "Routines" }).getByRole("button", { name: `Edit ${name}` });

const BENCH_PRESS = "Press banca\t8-10\t90\t62.5kg\t";

test("a routine created, edited and deleted reaches the server", async ({ page }) => {
  const uid = await signIn(page, "alice");
  await openRoutines(page);
  await createRoutine(page, "Empuje");

  await eventually(() => storedRoutines(uid)).toEqual([
    {
      id: expect.any(String),
      name: "Empuje",
      createdAt: expect.any(String),
      exercises: [BENCH_PRESS],
    },
  ]);
  const [created] = await storedRoutines(uid);

  await page.reload();
  await openRoutines(page);
  await expect(listed(page, "Empuje")).toBeVisible();

  await listed(page, "Empuje").click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit routine" })).toBeVisible();
  await page.getByRole("textbox", { name: "Routine name" }).fill("Empuje B");
  await page.getByRole("button", { name: "Save changes" }).click();

  await eventually(() => storedRoutines(uid)).toEqual([{ ...created, name: "Empuje B" }]);
  await expect(listed(page, "Empuje B")).toBeVisible();

  await page.getByRole("button", { name: "Delete Empuje B" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

  await eventually(() => storedRoutines(uid)).toEqual([]);
  await expect(page.getByText(/No routines yet/)).toBeVisible();
  await page.reload();
  await openRoutines(page);
  await expect(page.getByText(/No routines yet/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a routine created offline reaches the server once back online", async ({ page, context }) => {
  const uid = await signIn(page, "alice");
  await openRoutines(page);

  await context.setOffline(true);
  await createRoutine(page, "Offline");
  await expect(listed(page, "Offline")).toBeVisible();
  expect(await storedRoutines(uid)).toEqual([]);

  await context.setOffline(false);
  await eventually(() => storedRoutines(uid)).toEqual([
    {
      id: expect.any(String),
      name: "Offline",
      createdAt: expect.any(String),
      exercises: [BENCH_PRESS],
    },
  ]);

  await page.reload();
  await openRoutines(page);
  await expect(listed(page, "Offline")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
