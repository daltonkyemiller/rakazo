// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), back: vi.fn() }));
vi.mock("./api", () => ({ rpc: mocks.rpc }));
vi.mock("expo-router", () => ({
  router: { back: mocks.back },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "server-1" }),
}));
vi.mock("./native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("./i18n", () => {
  const t = (text: string) => text;
  return { useI18n: () => ({ t }) };
});
vi.mock("../components/glass-title", () => ({ glassHeaderOptions: () => ({}) }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({ label, children }: { label?: string; children?: ReactNode }) => (
    <section>
      {label}
      {children}
    </section>
  ),
  SettingsRow: ({
    title,
    value,
    detail,
    onPress,
  }: {
    title: string;
    value?: string;
    detail?: string;
    onPress?: () => void;
  }) =>
    onPress ? (
      <button type="button" onClick={onPress}>
        {title}
      </button>
    ) : (
      <div>
        {title}
        {value}
        {detail}
      </div>
    ),
  SettingsSwitch: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));

import McpServerScreen from "../app/(settings)/mcp-server";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.rpc.mockReset().mockImplementation(async (procedure: string) => {
    if (procedure === "mcp/servers/list")
      return [
        {
          id: "server-1",
          name: "Example",
          transport: "streamable_http",
          endpoint: "https://example.test/mcp",
        },
      ];
    if (procedure === "bots/list") return [{ id: "bot-1", name: "Scout" }];
    if (procedure === "mcp/assignments/all") return [];
    if (procedure === "mcp/assignments/list")
      return [{ serverId: "other", allowAllTools: false, allowedTools: ["read"] }];
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("manages an existing server without requiring newer health fields or native Mac approval", async () => {
  await act(async () => root.render(<McpServerScreen />));
  expect(container.textContent).toContain("example.test");
  expect(container.textContent).not.toContain("Test connection");
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[aria-label="Scout"]')!.click(),
  );
  expect(mocks.rpc).toHaveBeenCalledWith("mcp/assignments/replace", {
    botId: "bot-1",
    assignments: [
      { serverId: "other", allowAllTools: false, allowedTools: ["read"] },
      { serverId: "server-1", allowAllTools: true, allowedTools: [] },
    ],
  });
  expect(mocks.rpc).not.toHaveBeenCalledWith("mcp/servers/test", expect.anything());
});

it("shows a failing server's reason and tests it only on request", async () => {
  const fallback = mocks.rpc.getMockImplementation();
  mocks.rpc.mockImplementation(async (procedure: string) => {
    if (procedure === "mcp/servers/list")
      return [
        {
          id: "server-1",
          name: "Example",
          enabled: true,
          transport: "stdio",
          endpoint: null,
          command: "npx",
          args: ["-y", "example-mcp"],
          envKeys: ["EXAMPLE_KEY"],
          oauthStatus: "none",
          health: {
            status: "error",
            message: "Connection closed",
            toolCount: null,
            checkedAt: null,
          },
        },
      ];
    if (procedure === "mcp/servers/test") return { id: "server-1", name: "Example" };
    return fallback?.(procedure);
  });
  await act(async () => root.render(<McpServerScreen />));
  expect(container.textContent).toContain("Rakazo server");
  expect(container.textContent).toContain("Not working");
  expect(container.textContent).toContain("Connection closed");
  expect(container.textContent).toContain("npx -y example-mcp");
  expect(container.textContent).toContain("EXAMPLE_KEY");
  expect(mocks.rpc).not.toHaveBeenCalledWith("mcp/servers/test", expect.anything());
  const test = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Test connection",
  );
  await act(async () => test?.click());
  expect(mocks.rpc).toHaveBeenCalledWith("mcp/servers/test", { id: "server-1" });
});
