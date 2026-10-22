import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

async function captureInBothThemes(page: Page, testInfo: TestInfo, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await captureScreenshot(page, testInfo, `${name}-${theme}`);
  }
}

// Rows sit directly on the card: no fill or border of their own until hovered or pressed.
async function expectFlatRow(row: Locator) {
  await expect(row).toHaveCSS("border-top-width", "0px");
  await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(row).toHaveCSS("box-shadow", "none");
}

test("onboarding choices collapse to the pick on one surface", async ({ page }, testInfo) => {
  await signup(page, `onboarding-rows-${Date.now()}@rakazo.test`, "password12", "Sample");
  await completeOnboarding(page);
  const card = page.getByTestId("choice-card");
  await expect(card.getByText("What do you want me on first?", { exact: true })).toBeVisible();
  const option = card.getByRole("button", { name: "Inbox & email", exact: true });
  await expect(option).toContainText("B");
  await expectFlatRow(option);
  await captureInBothThemes(page, testInfo, "onboarding-choice-unanswered");

  await option.focus();
  await expect(option).toBeFocused();
  await page.keyboard.press("Enter");
  const answer = card.getByTestId("choice-answer");
  await expect(answer).toContainText("Inbox & email");
  await expect(answer.getByTestId("choice-letter")).toHaveText("B");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(card).not.toContainText("Day-to-day work");
  await captureInBothThemes(page, testInfo, "onboarding-choice-answered");
});

test("a bot question lists lettered choices, then collapses to the pick", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `choice-card-${stamp}@rakazo.test`, "password12", "Choice Card");
  await completeOnboarding(page);

  const botId = activeBotId(page);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("pick from these cities with tappable choices");
  await page.keyboard.press("Enter");

  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", {
          botId,
        });
        return snapshot.run?.status ?? null;
      },
      { timeout: 60_000 },
    )
    .toBe("waiting_input");

  // threads/get can observe waiting_input before the shell realtime feed paints the ask card.
  const card = page.getByTestId("question-card");
  if ((await card.count()) === 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/Message/)).toBeVisible({ timeout: 15_000 });
  }
  await expect(card.getByText("Which city should I use?", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const options = card.getByRole("group").getByRole("button");
  await expect(options).toHaveText(["ABerlin", "BSeoul", "CToronto", "DLisbon"]);
  const berlin = card.getByRole("button", { name: "Berlin", exact: true });
  const seoul = card.getByRole("button", { name: "Seoul", exact: true });
  await expectFlatRow(berlin);
  await expect(berlin.getByTestId("choice-letter")).toHaveCSS("width", "24px");

  // One vertical list of full-width rows inside a single card.
  const cardBox = (await card.boundingBox())!;
  const berlinBox = (await berlin.boundingBox())!;
  const seoulBox = (await seoul.boundingBox())!;
  expect(cardBox.width).toBeLessThanOrEqual(535);
  expect(seoulBox.y).toBeGreaterThan(berlinBox.y + berlinBox.height - 2);
  expect(Math.abs(berlinBox.x - seoulBox.x)).toBeLessThan(2);
  expect(Math.abs(berlinBox.width - seoulBox.width)).toBeLessThan(2);
  expect(berlinBox.width).toBeGreaterThan(cardBox.width - 40);
  await captureInBothThemes(page, testInfo, "question-card-unanswered");

  await page.setViewportSize({ width: 390, height: 844 });
  const lisbon = card.getByRole("button", { name: "Lisbon", exact: true });
  await expect(lisbon).toBeVisible();
  await expect(lisbon).toBeEnabled();
  await captureScreenshot(page, testInfo, "question-card-narrow");

  await page.setViewportSize({ width: 1280, height: 720 });
  await seoul.click();

  const answer = card.getByTestId("choice-answer");
  await expect(answer).toContainText("Seoul", { timeout: 30_000 });
  await expect(answer.getByTestId("choice-letter")).toHaveText("B");
  await expect(answer.getByTestId("choice-letter")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(card).not.toContainText("Berlin");
  // The outcome is announced, not shown as status text.
  await expect(card.getByText("Answered: Seoul", { exact: true })).toHaveClass(/sr-only/);

  await expect
    .poll(
      async () => {
        const history = await rpc<{
          messages: Array<{
            blocks: Array<{
              kind: string;
              status?: string;
              answer?: string;
              actions?: Array<{ id: string; label: string }>;
            }>;
          }>;
        }>(page, "threads/messages", { botId });
        const answered = history.messages
          .flatMap((message) => message.blocks)
          .find(
            (block) =>
              block.kind === "ask" &&
              block.status === "answered" &&
              Array.isArray(block.actions) &&
              block.actions.some((action) => action.id === "choice-2"),
          );
        return answered?.answer ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe("choice-2");

  await captureInBothThemes(page, testInfo, "question-card-answered");
});

test("a typed reply answers the latest question and resumes its run", async ({
  page,
}, testInfo) => {
  await signup(page, `typed-choice-${Date.now()}@rakazo.test`, "password12", "Typed Choice");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("pick from these cities with tappable choices");
  await page.keyboard.press("Enter");

  let waitingRunId: string | undefined;
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<{ run?: { id: string; status: string } | null }>(
          page,
          "threads/get",
          { botId },
        );
        waitingRunId = snapshot.run?.id;
        return snapshot.run?.status;
      },
      { timeout: 60_000 },
    )
    .toBe("waiting_input");
  const seoul = page.getByRole("button", { name: "Seoul", exact: true });
  await expect(seoul).toBeVisible({ timeout: 15_000 });
  await composer.fill("Paris");
  await page.keyboard.press("Enter");

  const answer = page.getByTestId("question-card").getByTestId("choice-answer");
  await expect(answer).toContainText("Paris", { timeout: 30_000 });
  await expect(answer.getByTestId("choice-letter")).toHaveCount(0);
  await expect(seoul).toHaveCount(0);
  await expect
    .poll(async () => {
      const snapshot = await rpc<{
        messages: Array<{
          role: string;
          runId: string | null;
          blocks: Array<{ kind: string; text?: string }>;
        }>;
      }>(page, "threads/get", { botId });
      return snapshot.messages.findLast(
        (message) =>
          message.role === "user" &&
          message.blocks.some((block) => block.kind === "text" && block.text === "Paris"),
      )?.runId;
    })
    .toBe(waitingRunId);
  await captureScreenshot(page, testInfo, "choice-card-typed-reply");
});
