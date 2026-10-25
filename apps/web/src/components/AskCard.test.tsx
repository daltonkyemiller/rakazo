// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));
vi.mock("@rakazo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../lib/rpc", () => ({ rpc: {} }));

import { ChoiceCard } from "../pages/shell/message-cards";
import type { AskBlock } from "./AskCard";
import { AskCard } from "./AskCard";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const secretCard: AskBlock = {
  kind: "ask",
  text: "API key",
  input: "secret",
  purpose: "api_key",
  credential: { name: "example_api", origin: "https://api.example.test", auth: { type: "bearer" } },
  status: "pending",
};

async function render(
  block: AskBlock,
  onDismiss: () => Promise<void> = async () => undefined,
  onAnswer: (text: string, username?: string) => Promise<void> = async () => undefined,
) {
  await act(async () =>
    root.render(
      <AskCard block={block} canAnswer canDismiss onAnswer={onAnswer} onDismiss={onDismiss} />,
    ),
  );
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === name);
}

async function type(label: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("dismisses a secret card without sending the typed value", async () => {
  const onAnswer = vi.fn(async () => undefined);
  const onDismiss = vi.fn(async () => undefined);
  await render(secretCard, onDismiss, onAnswer);
  await type("API key", "example-key");

  await act(async () => button("Dismiss")!.click());

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledWith();
  expect(onAnswer).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Dismissed");
  expect(button("Dismiss")).toBeUndefined();
  expect(container.querySelector("input")).toBeNull();
});

it("shows a generic error when dismissing fails", async () => {
  await render(secretCard, async () => {
    throw new Error("server detail");
  });

  await act(async () => button("Dismiss")!.click());

  expect(container.textContent).toContain("Could not submit this answer");
  expect(container.textContent).not.toContain("server detail");
  expect(button("Dismiss")!.disabled).toBe(false);
});

it("shows a dismissed secret card as Dismissed, not Saved", async () => {
  await render({ ...secretCard, status: "answered", answer: "", dismissed: true });
  expect(container.textContent).toContain("Dismissed");
  expect(container.textContent).not.toContain("Saved");
  expect(button("Dismiss")).toBeUndefined();

  await render({ ...secretCard, status: "answered", answer: "" });
  expect(container.textContent).toContain("Saved");
  const card = container.querySelector('[data-testid="secret-ask-card"]')!;
  expect(card.classList.contains("w-full")).toBe(true);
  expect(card.classList.contains("max-w-xl")).toBe(false);
});

it("offers Dismiss only on secret cards", async () => {
  await render({ kind: "ask", text: "Which city?", status: "pending" });
  expect(button("Dismiss")).toBeUndefined();
});

it("puts primary Save before equal-width secondary Dismiss", async () => {
  await render(secretCard);
  expect(
    [...button("Save")!.parentElement!.querySelectorAll("button")].map((item) => item.textContent),
  ).toEqual(["Save", "Dismiss"]);
  expect(button("Save")?.classList.contains("bg-primary")).toBe(true);
  expect(button("Dismiss")?.classList.contains("border-border")).toBe(true);
  expect(button("Save")!.disabled).toBe(true);
  expect(container.querySelector("input")?.classList.contains("w-full")).toBe(true);
  const card = container.querySelector('[data-testid="secret-ask-card"]')!;
  expect(card.classList.contains("w-full")).toBe(true);
  expect(card.classList.contains("max-w-xl")).toBe(false);
  for (const label of ["Save", "Dismiss"]) {
    expect(button(label)?.classList.contains("flex-1")).toBe(true);
    expect(button(label)?.classList.contains("whitespace-normal")).toBe(true);
  }
  await type("API key", "example-key");
  expect(button("Save")!.disabled).toBe(false);
});

it("styles dismissed secrets like denied approvals, apart from the destination", async () => {
  await render({ ...secretCard, status: "answered", dismissed: true });
  const dismissed = [...container.querySelectorAll("div")].find(
    (item) => item.textContent === "Dismissed",
  )!;
  expect(dismissed.classList.contains("font-medium")).toBe(true);
  expect(dismissed.classList.contains("mt-3.5")).toBe(true);
  expect(dismissed.classList.contains("text-muted-foreground")).toBe(true);
});

for (const input of ["secret", "login"]) {
  it.each([true, false])(`gates only ${input} dismissal: %s`, async (canDismiss) => {
    const block = {
      kind: "ask" as const,
      text: "Secret",
      input: "secret" as const,
      status: "pending" as const,
      ...(input === "login"
        ? {
            credential: {
              name: "example",
              origin: "https://example.test",
              auth: { type: "login" as const },
            },
          }
        : {}),
    };
    await act(async () =>
      root.render(
        <AskCard
          block={block}
          canAnswer
          canDismiss={canDismiss}
          onAnswer={async () => {}}
          onDismiss={async () => {}}
        />,
      ),
    );
    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels.includes("Dismiss")).toBe(canDismiss);
    // A login is filled in only by the run's user; see the credential card test below.
    if (input === "login" && !canDismiss) return;
    expect(labels.includes("Save")).toBe(true);
    expect(button("Save")?.classList.contains("flex-1")).toBe(true);
  });
}

it("keeps an accepted secret Save answered without a block update", async () => {
  const onAnswer = vi.fn(async () => undefined);
  await render(secretCard, undefined, onAnswer);
  await type("API key", "example-key");

  await act(async () => button("Save")!.click());

  expect(onAnswer).toHaveBeenCalledWith("example-key", undefined);
  expect(container.textContent).toContain("Saved");
  expect(container.textContent).not.toContain("example-key");
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector(".text-destructive")).toBeNull();
});

it("keeps an accepted question choice answered until the block updates", async () => {
  const block: AskBlock = {
    kind: "ask",
    text: "Which city?",
    status: "pending",
    actions: [
      { id: "paris", label: "Paris" },
      { id: "london", label: "London" },
    ],
  };
  const onAnswer = vi.fn(async () => undefined);
  await render(block, undefined, onAnswer);

  await act(async () => option("Paris")!.click());

  expect(onAnswer).toHaveBeenCalledWith("paris", undefined);
  expect(container.textContent).toContain("Answered: Paris");
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector(".text-destructive")).toBeNull();

  await render({ ...block, status: "answered", answer: "london" });
  expect(container.textContent).toContain("Answered: London");
  expect(container.textContent).not.toContain("Answered: Paris");
});

const question: AskBlock = {
  kind: "ask",
  text: "Which should I put at the top of tomorrow's read out?",
  status: "pending",
  actions: [
    { id: "choice-1", label: "Client and billing issues" },
    { id: "choice-2", label: "Releases and production deploys" },
    { id: "choice-3", label: "Onboarding bugs" },
    { id: "choice-4", label: "Hiring" },
  ],
};
const accent = {
  id: "ember",
  name: "Ember",
  light: "#c2410c",
  dark: "#9a3412",
  eyeColor: "#ffffff",
  hex: "#c2410c",
};

async function renderQuestion(
  block: AskBlock,
  onAnswer: (text: string) => Promise<void> = async () => undefined,
  canAnswer = true,
) {
  await act(async () =>
    root.render(
      <AskCard
        block={block}
        accent={accent}
        canAnswer={canAnswer}
        canDismiss={false}
        onAnswer={onAnswer}
        onDismiss={async () => {}}
      />,
    ),
  );
}

function option(label: string) {
  return [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.endsWith(label),
  );
}

it("lists a question's choices as lettered rows on one surface", async () => {
  await renderQuestion(question);

  const group = container.querySelector("fieldset")!;
  const title = document.getElementById(group.getAttribute("aria-labelledby")!)!;
  expect(title.textContent).toBe(question.text);
  expect([...group.querySelectorAll("button")].map((item) => item.textContent)).toEqual([
    "AClient and billing issues",
    "BReleases and production deploys",
    "COnboarding bugs",
    "DHiring",
  ]);
  for (const row of group.querySelectorAll("button")) {
    expect(row.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(row.querySelector('[data-testid="choice-letter"]')?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  }
  expect(container.querySelectorAll('[data-testid="question-card"]')).toHaveLength(1);
  expect(container.textContent).not.toContain("Answered");
});

it("sends one choice at a time and keeps the rest disabled while it is pending", async () => {
  let release: () => void = () => undefined;
  const onAnswer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await renderQuestion(question, onAnswer);

  await act(async () => option("Onboarding bugs")!.click());
  await act(async () => option("Hiring")!.click());

  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onAnswer).toHaveBeenCalledWith("choice-3", undefined);
  expect(option("Onboarding bugs")!.getAttribute("aria-busy")).toBe("true");
  expect(option("Hiring")!.disabled).toBe(true);

  await act(async () => release());
  expect(container.querySelector("button")).toBeNull();
});

it("collapses an answered question to the picked row in the bot's color", async () => {
  await renderQuestion({ ...question, status: "answered", answer: "choice-3" });

  const answer = container.querySelector('[data-testid="choice-answer"]')!;
  const letter = answer.querySelector<HTMLElement>('[data-testid="choice-letter"]')!;
  expect(letter.textContent).toBe("C");
  expect(letter.style.backgroundColor).toBe("rgb(194, 65, 12)");
  expect(letter.style.color).toBe("rgb(255, 255, 255)");
  expect(answer.querySelector(".sr-only")?.textContent).toBe("Answered: Onboarding bugs");
  expect(container.textContent).not.toContain("Hiring");
  expect(container.querySelector("button")).toBeNull();
  const title = container.querySelector('[data-testid="question-card"] > div')!;
  expect(title.classList.contains("text-muted-foreground")).toBe(true);
});

it("shows a typed answer to a question without a letter", async () => {
  await renderQuestion({ ...question, status: "answered", answer: "Something else entirely" });

  const answer = container.querySelector('[data-testid="choice-answer"]')!;
  expect(answer.querySelector('[data-testid="choice-letter"]')).toBeNull();
  expect(answer.textContent).toContain("Something else entirely");
});

it("keeps a question open with an error when sending fails", async () => {
  await renderQuestion(question, async () => {
    throw new Error("Network down");
  });

  await act(async () => option("Hiring")!.click());

  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Network down");
  expect(option("Hiring")!.disabled).toBe(false);
  expect(container.querySelector('[data-testid="choice-answer"]')).toBeNull();
});

it("shows an inactive question without choices", async () => {
  await renderQuestion(question, undefined, false);
  expect(container.textContent).toContain("No longer active");
  expect(container.querySelector("button")).toBeNull();
});

it("keeps approval asks on their own buttons", async () => {
  await render({
    kind: "ask",
    text: "Run this command?",
    approvalEffectId: "effect-1",
    status: "pending",
    actions: [
      { id: "allow", label: "Allow" },
      { id: "deny", label: "Deny" },
    ],
  });
  expect(container.querySelector('[data-testid="question-card"]')).toBeNull();
  expect(button("Allow once")).toBeDefined();
});

it("matches onboarding choices to the question card and collapses to the pick", async () => {
  const block = {
    kind: "choice" as const,
    question: "Which city?",
    options: [
      { id: "paris", letter: "A", label: "Paris" },
      { id: "london", letter: "B", label: "London" },
    ],
  };
  const renderChoice = (answerId?: string) =>
    act(async () =>
      root.render(
        <ChoiceCard
          botId="bot"
          block={{ ...block, answerId }}
          accent={accent}
          onBotChanged={async () => {}}
        />,
      ),
    );

  await renderChoice();
  const paris = option("Paris")!;
  expect(paris.disabled).toBe(false);
  expect(paris.textContent).toBe("AParis");
  expect(paris.classList.contains("focus-visible:ring-2")).toBe(true);
  expect(button("")?.getAttribute("aria-label")).toBe("Dismiss");

  await renderChoice("london");
  const letter = container.querySelector<HTMLElement>(
    '[data-testid="choice-answer"] [data-testid="choice-letter"]',
  )!;
  expect(letter.textContent).toBe("B");
  expect(letter.style.backgroundColor).toBe("rgb(194, 65, 12)");
  expect(container.textContent).not.toContain("Paris");
  expect(container.querySelector("button")).toBeNull();
});

it.each([
  [
    "login",
    { name: "example_login", origin: "https://login.example.test", auth: { type: "login" } },
  ],
  ["API", { name: "example_api", origin: "https://api.example.test", auth: { type: "bearer" } }],
] as const)(
  "shows a %s credential card read-only to anyone but the run's user",
  async (_name, credential) => {
    const render = (canDismiss: boolean) =>
      act(async () =>
        root.render(
          <AskCard
            block={{ kind: "ask", text: "Secret", input: "secret", status: "pending", credential }}
            canAnswer
            canDismiss={canDismiss}
            onAnswer={async () => {}}
            onDismiss={async () => {}}
          />,
        ),
      );

    await render(false);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toContain(credential.origin);
    expect(container.textContent).not.toContain("No longer active");

    await render(true);
    expect(container.querySelectorAll("input").length).toBeGreaterThan(0);
    expect(button("Save")).toBeDefined();
  },
);

it("keeps a connector code card open to others in the chat, without Dismiss", async () => {
  await act(async () =>
    root.render(
      <AskCard
        block={{ kind: "ask", text: "Code", input: "secret", purpose: "otp", status: "pending" }}
        canAnswer
        canDismiss={false}
        onAnswer={async () => {}}
        onDismiss={async () => {}}
      />,
    ),
  );
  expect(container.querySelector("input")).not.toBeNull();
  expect(button("Save")).toBeDefined();
  expect(button("Dismiss")).toBeUndefined();
});

it("offers import on the unanswered first-run focus card only", async () => {
  const focus = {
    kind: "choice" as const,
    question: "What do you want me on first?",
    options: [{ id: "inbox", letter: "A", label: "Inbox & email" }],
  };
  const onImportAgent = vi.fn();
  const link = () =>
    [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Import an agent",
    );
  await act(async () =>
    root.render(
      <ChoiceCard
        botId="bot"
        block={focus}
        onBotChanged={async () => {}}
        onImportAgent={onImportAgent}
      />,
    ),
  );
  await act(async () => link()!.click());
  expect(onImportAgent).toHaveBeenCalledTimes(1);
  // Not once the question is answered, and never on another choice card.
  for (const block of [
    { ...focus, answerId: "inbox" },
    { ...focus, question: "Which city?" },
  ]) {
    await act(async () =>
      root.render(
        <ChoiceCard
          botId="bot"
          block={block}
          onBotChanged={async () => {}}
          onImportAgent={onImportAgent}
        />,
      ),
    );
    expect(link()).toBeUndefined();
  }
});
