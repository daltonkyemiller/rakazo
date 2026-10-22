// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import type { MessageBlock } from "@rakazo/contracts";
import { isChoiceAskBlock } from "@rakazo/core";
import { botChatColors, fontWeight, typeScale } from "@rakazo/ui-tokens";
import type { ReactNode } from "react";
import React, { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { Pressable, Text, View } from "react-native";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileMessage } from "./api";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : ((style as Record<string, unknown>) ?? {});
  const element =
    (tag: string) =>
    ({ children, style, testID }: { children?: ReactNode; style?: unknown; testID?: string }) =>
      createElement(
        tag,
        {
          "data-style": JSON.stringify(
            flatten(typeof style === "function" ? style({ pressed: false }) : style),
          ),
          "data-testid": testID,
        },
        children,
      );
  return {
    Alert: { alert: vi.fn() },
    Pressable: element("button"),
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
    Text: element("span"),
    View: element("div"),
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 1, fontScale: 1 }),
  };
});

vi.mock("./api", () => ({ rpc: vi.fn() }));

vi.mock("./native", () => ({
  native: { fill: "fill", fillPressed: "fill-pressed" },
  useMobileTokens: () => ({}),
}));

vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));

import { AskQuestionCard } from "../components/AskQuestionCard";
import { McpApprovalCard } from "../components/McpApprovalCard";

// Render the screen's actual message bubble without importing its native dependencies.
const testFileUrl = import.meta.url;
const source = readFileSync(new URL("../app/thread.tsx", testFileUrl), "utf8");
const bubbleSource = source.slice(
  source.indexOf("const MessageBubble = memo(function MessageBubble({"),
  source.indexOf("function MessageTextCard({"),
);
const scope = {
  typeScale,
  fontWeight,
  React,
  memo: <T,>(component: T) => component,
  useState,
  useResolvedAppearance: () => "light",
  mobileTokens: () => ({}),
  botChatColors,
  isChoiceAskBlock,
  speakerColorDefFor: () => undefined,
  AskQuestionCard,
  useI18n: () => ({ t: (text: string) => text }),
  isApprovalAskBlock: (block: { actions?: { id: string }[] }) =>
    Boolean(block.actions?.some((action) => action.id === "allow")),
  plainAskTitle: (text: string) => text,
  formatApprovalAnswer: () => "Answered",
  View,
  Text,
  Pressable,
  AskActions: () => <button type="button">Answer</button>,
};
const MessageBubble = new Function(
  ...Object.keys(scope),
  ts.transpileModule(`${bubbleSource}\nreturn MessageBubble;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(...Object.values(scope));

const longQuestion =
  "Should I move the weekly planning notes into the shared folder and tell everyone on the project where to find them from now on?";

type CardStyle = { width?: unknown; maxWidth?: unknown };

function styleOf(element: Element | null | undefined): CardStyle {
  if (!element) throw new Error("missing card");
  return JSON.parse(element.getAttribute("data-style") ?? "{}");
}

describe("thread cards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  function renderAsk(ask: Partial<Extract<MessageBlock, { kind: "ask" }>>, canAnswer: boolean) {
    const message = {
      id: "message-1",
      role: "bot",
      blocks: [
        {
          kind: "ask",
          text: longQuestion,
          status: "pending",
          actions: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          ...ask,
        },
      ],
    } as MobileMessage;
    act(() =>
      root.render(
        <MessageBubble
          botId="bot-1"
          bots={[]}
          message={message}
          canAnswer={canAnswer}
          onAnswer={async () => undefined}
          actionProps={{}}
        />,
      ),
    );
    const question = [...container.querySelectorAll("span")].find(
      (span) => span.textContent === longQuestion,
    );
    return question?.parentElement;
  }

  // The iOS message menu hosts each bubble without a definite width, so a percentage width
  // resolves against the card's own cap instead of the message column and overflows the screen.
  it.each([
    ["expired", {}, false],
    ["answered", { status: "answered" as const, answer: "yes" }, false],
    ["active", {}, true],
  ])("sizes a long %s choice question to the bot row in points", (_, ask, canAnswer) => {
    renderAsk(ask, canAnswer);
    const card = container.querySelector("[data-testid='question-card']");
    expect(card?.textContent).toContain(longQuestion);
    expect(styleOf(card)).toMatchObject({ width: 317 });
    expect(styleOf(card).maxWidth).toBeUndefined();
  });

  it("bounds a long approval card by its cap, not a percentage width", () => {
    const card = renderAsk(
      {
        approvalEffectId: "effect-1",
        actions: [
          { id: "allow", label: "Allow once" },
          { id: "deny", label: "Deny" },
        ],
      },
      true,
    );
    expect(card?.textContent).toContain(longQuestion);
    expect(container.querySelector("[data-testid='question-card']")).toBeNull();
    expect(styleOf(card)).toMatchObject({ maxWidth: 576 });
    expect(styleOf(card).width).toBeUndefined();
  });

  it.each([
    ["an unmarked", undefined, undefined, 15],
    ["a text", "text" as const, undefined, 15],
    ["a code", "code" as const, "Menlo", 14],
    ["an unmarked approval", undefined, "Menlo", 14, "effect-1"],
    ["a text approval", "text" as const, undefined, 15, "effect-1"],
  ])(
    "sets %s question detail in its font",
    (_, detailFormat, fontFamily, fontSize, effectId?: string) => {
      const detail = "Tap one option, or reply in your own words.";
      renderAsk({ detail, detailFormat, approvalEffectId: effectId }, true);
      const line = [...container.querySelectorAll("span")].find(
        (span) => span.textContent === detail,
      );
      const style: { fontFamily?: string; fontSize?: number } = JSON.parse(
        line?.getAttribute("data-style") ?? "{}",
      );
      expect(style.fontFamily).toBe(fontFamily);
      expect(style.fontSize).toBe(fontSize);
    },
  );

  it("bounds the MCP approval card the same way", () => {
    act(() =>
      root.render(
        <McpApprovalCard
          botId="bot-1"
          block={{
            kind: "mcp_approval",
            serverId: "server-1",
            name: "Example notes",
            transport: "streamable_http",
            endpoint: "https://mcp.example.test/a/very/long/endpoint/path/for/the/notes/server",
            needsOAuth: false,
            status: "pending",
          }}
        />,
      ),
    );
    const card = container.firstElementChild;
    expect(card?.textContent).toContain("Example notes");
    expect(styleOf(card)).toMatchObject({ maxWidth: 576 });
    expect(styleOf(card).width).toBeUndefined();
  });
});
