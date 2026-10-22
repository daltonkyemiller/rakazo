// @vitest-environment jsdom

import type { MessageBlock } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const alert = vi.hoisted(() => vi.fn());

vi.mock("react-native", async () => {
  const { createElement } = await import("react");

  function MockView(props: {
    children?: ReactNode;
    testID?: string;
    accessibilityLabel?: string;
    style?: unknown;
  }) {
    return createElement(
      "div",
      {
        "data-testid": props.testID,
        "aria-label": props.accessibilityLabel,
        "data-style": JSON.stringify(Object.assign({}, ...[props.style].flat())),
      },
      props.children,
    );
  }

  function MockText(props: { children?: ReactNode; accessibilityRole?: string; style?: unknown }) {
    return createElement(
      "span",
      {
        role: props.accessibilityRole,
        "data-style": JSON.stringify(Object.assign({}, ...[props.style].flat())),
      },
      props.children,
    );
  }

  function MockPressable(props: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityState?: { disabled?: boolean; selected?: boolean; busy?: boolean };
    testID?: string;
  }) {
    const disabled = Boolean(props.disabled || props.accessibilityState?.disabled);
    return createElement(
      "button",
      {
        type: "button",
        disabled,
        "aria-label": props.accessibilityLabel,
        "aria-selected": props.accessibilityState?.selected ? "true" : "false",
        "aria-busy": props.accessibilityState?.busy ? "true" : "false",
        "data-testid": props.testID,
        onClick: () => {
          if (!disabled) props.onPress?.();
        },
      },
      props.children,
    );
  }

  return {
    Alert: { alert },
    Pressable: MockPressable,
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    Text: MockText,
    View: MockView,
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 1, fontScale: 1 }),
  };
});

vi.mock("./api", () => ({ rpc }));

vi.mock("./native", () => ({
  native: { fill: "fill", fillPressed: "fill-pressed" },
  useMobileTokens: () => ({
    background: "background",
    border: "border",
    card: "card",
    foreground: "foreground",
    muted: "muted-surface",
    mutedForeground: "muted",
    primary: "primary",
    primaryForeground: "primary-foreground",
  }),
}));

vi.mock("../components/native-symbol", () => ({
  NativeSymbol: () => null,
}));

import { AskQuestionCard } from "../components/AskQuestionCard";
import { ChoiceCard } from "../components/ChoiceCard";

type ChoiceBlock = Extract<MessageBlock, { kind: "choice" }>;

const choice: ChoiceBlock = {
  kind: "choice",
  question: "What do you want me on first?",
  options: [
    { id: "day", letter: "A", label: "Day-to-day work" },
    { id: "inbox", letter: "B", label: "Inbox & email" },
  ],
};

function button(container: HTMLElement, label: string) {
  const element = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`missing button ${label}`);
  return element;
}

describe("ChoiceCard", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    rpc.mockReset();
    alert.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function render(block: ChoiceBlock = choice, onDismissed?: () => void) {
    if (!container) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    act(() => {
      root?.render(<ChoiceCard botId="bot-1" block={block} onDismissed={onDismissed} />);
    });
    return container;
  }

  it("sets the question as a semibold header and the subtitle as secondary text", () => {
    const view = render({ ...choice, subtitle: "Pick one to start." });
    const style = (selector: string) =>
      JSON.parse(view.querySelector<HTMLElement>(selector)?.dataset.style ?? "{}");

    expect(style('[role="header"]')).toMatchObject({
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: "foreground",
    });
    expect(style("[data-testid='choice-card']")).toMatchObject({
      backgroundColor: "muted-surface",
    });
    expect(button(view, "Day-to-day work").textContent).toBe("ADay-to-day work");
    const subtitle = [...view.querySelectorAll<HTMLElement>("span")].find(
      (span) => span.textContent === "Pick one to start.",
    );
    expect(JSON.parse(subtitle?.dataset.style ?? "{}")).toMatchObject({
      fontSize: 15,
      lineHeight: 19,
    });
  });

  it("chooses through onboarding/choose and keeps only that option", async () => {
    rpc.mockResolvedValue({});
    const view = render();

    await act(async () => {
      button(view, "Inbox & email").click();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("onboarding/choose", { botId: "bot-1", optionId: "inbox" });
    expect(view.textContent).toContain("Inbox & email");
    expect(view.textContent).not.toContain("Day-to-day work");
    expect(view.querySelector("button")).toBeNull();
    expect(view.querySelector("[data-testid='question-answer']")?.getAttribute("aria-label")).toBe(
      "Answered: Inbox & email",
    );
  });

  it("dismisses through onboarding/dismissFocus and hides the card", async () => {
    rpc.mockResolvedValue({});
    const onDismissed = vi.fn();
    const view = render(choice, onDismissed);

    await act(async () => {
      button(view, "Dismiss").click();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledWith("onboarding/dismissFocus", { botId: "bot-1" });
    expect(onDismissed).toHaveBeenCalledTimes(1);
    expect(view.querySelector("[data-testid='choice-card']")).toBeNull();
  });

  it("disables every control while a request is in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = render();

    await act(async () => {
      button(view, "Day-to-day work").click();
      button(view, "Inbox & email").click();
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("onboarding/choose", {
      botId: "bot-1",
      optionId: "day",
    });
    expect(button(view, "Day-to-day work").disabled).toBe(true);
    expect(button(view, "Inbox & email").disabled).toBe(true);
    expect(button(view, "Dismiss").disabled).toBe(true);
    expect(view.textContent).toContain("Inbox & email");

    button(view, "Inbox & email").click();
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({});
      await Promise.resolve();
    });

    expect(view.textContent).toContain("Day-to-day work");
    expect(view.textContent).not.toContain("Inbox & email");
  });

  it("reports a failed request and leaves the card unanswered", async () => {
    rpc.mockRejectedValueOnce(new Error("Network down"));
    const view = render();

    await act(async () => {
      button(view, "Inbox & email").click();
      await Promise.resolve();
    });

    expect(alert).toHaveBeenCalledWith("Could not complete action", "Network down");
    expect(button(view, "Day-to-day work").disabled).toBe(false);
    expect(button(view, "Inbox & email").disabled).toBe(false);
    expect(view.querySelector("[data-testid='choice-card-dismiss']")).not.toBeNull();

    rpc.mockResolvedValueOnce({});
    await act(async () => {
      button(view, "Inbox & email").click();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenLastCalledWith("onboarding/choose", {
      botId: "bot-1",
      optionId: "inbox",
    });
    expect(view.textContent).not.toContain("Day-to-day work");
  });

  it("lets a later server answer replace the option chosen locally", async () => {
    rpc.mockResolvedValue({});
    const view = render();

    await act(async () => {
      button(view, "Day-to-day work").click();
      await Promise.resolve();
    });
    expect(view.textContent).not.toContain("Inbox & email");

    render({ ...choice, answerId: "inbox" });

    expect(view.textContent).toContain("Inbox & email");
    expect(view.textContent).not.toContain("Day-to-day work");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

const accent = {
  id: "ember",
  name: "Ember",
  light: "#c2410c",
  dark: "#9a3412",
  eyeColor: "#ffffff",
  hex: "#c2410c",
};

type AskBlock = Extract<MessageBlock, { kind: "ask" }>;

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

describe("AskQuestionCard", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    alert.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function render(
    block: AskBlock = question,
    onAnswer: (answer: string) => Promise<void> = async () => undefined,
    canAnswer = true,
  ) {
    if (!container) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    act(() => {
      root?.render(
        <AskQuestionCard block={block} accent={accent} canAnswer={canAnswer} onAnswer={onAnswer} />,
      );
    });
    return container;
  }

  const letterStyle = (view: HTMLElement) =>
    JSON.parse(
      view.querySelector<HTMLElement>("[data-testid='question-answer-letter']")?.dataset.style ??
        "{}",
    );

  it("letters each option and sends one pick while the rest wait", async () => {
    let release: () => void = () => undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const view = render(question, onAnswer);

    expect([...view.querySelectorAll("button")].map((item) => item.textContent)).toEqual([
      "AClient and billing issues",
      "BReleases and production deploys",
      "COnboarding bugs",
      "DHiring",
    ]);

    await act(async () => {
      button(view, "Onboarding bugs").click();
      button(view, "Hiring").click();
    });

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("choice-3");
    expect(button(view, "Onboarding bugs").getAttribute("aria-busy")).toBe("true");
    expect(button(view, "Hiring").disabled).toBe(true);

    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(view.querySelector("button")).toBeNull();
    expect(view.textContent).toContain("Onboarding bugs");
    expect(view.textContent).not.toContain("Hiring");
    expect(letterStyle(view)).toMatchObject({ backgroundColor: "#c2410c" });
  });

  it("collapses an answered question to its pick, the question muted", () => {
    const view = render({ ...question, status: "answered", answer: "choice-2" });
    const style = (selector: string) =>
      JSON.parse(view.querySelector<HTMLElement>(selector)?.dataset.style ?? "{}");

    expect(view.querySelector("button")).toBeNull();
    expect(view.querySelector("[data-testid='question-answer']")?.getAttribute("aria-label")).toBe(
      "Answered: Releases and production deploys",
    );
    expect(view.querySelector("[data-testid='question-answer-letter']")?.textContent).toBe("B");
    expect(letterStyle(view)).toMatchObject({ backgroundColor: "#c2410c" });
    expect(style('[role="header"]')).toMatchObject({ color: "muted" });
    expect(view.textContent).not.toContain("Client and billing issues");
  });

  it("shows a typed answer without a letter", () => {
    const view = render({ ...question, status: "answered", answer: "Something else" });

    expect(view.querySelector("[data-testid='question-answer-letter']")).toBeNull();
    expect(view.textContent).toContain("Something else");
  });

  it("reports a failed pick and keeps every option open", async () => {
    const view = render(question, async () => {
      throw new Error("Network down");
    });

    await act(async () => {
      button(view, "Hiring").click();
      await Promise.resolve();
    });

    expect(alert).toHaveBeenCalledWith("Could not submit answer", "Network down");
    expect(button(view, "Hiring").disabled).toBe(false);
    expect(view.querySelector("[data-testid='question-answer']")).toBeNull();
  });

  it("shows an inactive question without options", () => {
    const view = render(question, undefined, false);

    expect(view.querySelector("button")).toBeNull();
    expect(view.textContent).toContain("No longer active");
  });
});
