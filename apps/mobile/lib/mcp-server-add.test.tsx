// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpServerAdd } from "../components/mcp-server-add";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ rpc }));
vi.mock("./appearance", () => ({ mobileTokens: () => ({ destructive: "red" }) }));
vi.mock("./native", () => ({ native: {}, useThemedStyles: (factory: () => unknown) => factory() }));
vi.mock("./i18n", () => {
  const t = (text: string, values?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => values?.[key] ?? match);
  return { t, useI18n: () => ({ t }) };
});
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../components/native-segmented-control", () => ({
  NativeSegmentedControl: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({
    label,
    footer,
    children,
  }: {
    label?: string;
    footer?: string;
    children: ReactNode;
  }) => (
    <section>
      {label}
      {children}
      {footer}
    </section>
  ),
  SettingsRow: ({
    title,
    value,
    detail,
    accessibilityLabel,
    onPress,
  }: {
    title: string;
    value?: string;
    detail?: string;
    accessibilityLabel?: string;
    onPress?: () => void;
  }) =>
    onPress ? (
      <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
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
    onChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    onEndEditing,
    accessibilityLabel,
    secureTextEntry,
  }: {
    value?: string;
    onChangeText?: (value: string) => void;
    onEndEditing?: () => void;
    accessibilityLabel?: string;
    secureTextEntry?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      type={secureTextEntry ? "password" : "text"}
      value={value}
      onBlur={onEndEditing}
      onChange={(event) => onChangeText?.(event.target.value)}
    />
  ),
  Platform: { select: (options: { default: unknown }) => options.default },
  StyleSheet: { create: (styles: unknown) => styles },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  rpc.mockReset().mockImplementation(async (proc: string, body: Record<string, unknown>) => {
    if (proc === "bots/list") return [{ id: "bot-1", name: "Scout", archivedAt: null }];
    if (proc === "mcp/assignments/all") {
      return [{ botId: "bot-1", serverId: "existing", allowAllTools: true, allowedTools: [] }];
    }
    if (proc === "mcp/servers/create") return { id: "srv-new", ...body };
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

const input = (label: string) => {
  const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing ${label}`);
  return element;
};
const button = (label: string) => {
  const element = [...container.querySelectorAll("button")].find(
    (entry) => (entry.getAttribute("aria-label") ?? entry.textContent) === label,
  );
  if (!element) throw new Error(`Missing ${label}`);
  return element;
};

async function type(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

it("adds a pasted URL and grants agents without dropping their other servers", async () => {
  const onAdded = vi.fn();
  const onDone = vi.fn();
  await act(async () =>
    root.render(<McpServerAdd servers={[]} onAdded={onAdded} onDone={onDone} />),
  );
  // A paste that reads as a server skips straight to its review.
  await type(input("URL, command, or config"), "https://mcp.linear.app/mcp");
  expect(input("Server name").value).toBe("Linear");
  expect(container.textContent).not.toContain("Rakazo server");
  await click(input("Scout"));
  await click(button("Add server"));

  expect(rpc).toHaveBeenCalledWith("mcp/servers/create", {
    slug: "linear",
    name: "Linear",
    transport: "streamable_http",
    endpoint: "https://mcp.linear.app/mcp",
    headers: {},
    enabled: true,
  });
  expect(rpc).toHaveBeenCalledWith("mcp/assignments/replace", {
    botId: "bot-1",
    assignments: [
      { serverId: "existing", allowAllTools: true, allowedTools: [] },
      { serverId: "srv-new", allowAllTools: true, allowedTools: [] },
    ],
  });
  expect(onAdded).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("requires real values for placeholder secrets and runs commands on the server", async () => {
  await act(async () =>
    root.render(<McpServerAdd servers={[]} onAdded={vi.fn()} onDone={vi.fn()} />),
  );
  await type(
    input("URL, command, or config"),
    `BRAVE_API_KEY="<api-key>" npx -y @brave/brave-search-mcp-server --region "us east"`,
  );
  expect(container.textContent).toContain("Runs onRakazo server");
  expect(input("BRAVE_API_KEY").type).toBe("password");
  await click(button("Add server"));
  expect(container.textContent).toContain("Add a value for BRAVE_API_KEY.");
  expect(rpc).not.toHaveBeenCalledWith("mcp/servers/create", expect.anything());

  await type(input("BRAVE_API_KEY"), "real-key");
  await click(button("Add server"));
  expect(rpc).toHaveBeenCalledWith(
    "mcp/servers/create",
    expect.objectContaining({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@brave/brave-search-mcp-server", "--region", "us east"],
      env: { BRAVE_API_KEY: "real-key" },
    }),
  );
});

it("explains input it will not evaluate", async () => {
  await act(async () =>
    root.render(<McpServerAdd servers={[]} onAdded={vi.fn()} onDone={vi.fn()} />),
  );
  const source = input("URL, command, or config");
  await type(source, "npx server | tee log");
  await act(async () => {
    source.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(container.textContent).toContain(
    "Shell variables, pipes, and substitutions are not run. Use plain values.",
  );
  expect(() => button("Add server")).toThrow();
});

it("returns to the source to edit it, and requires a token when one is chosen", async () => {
  await act(async () =>
    root.render(<McpServerAdd servers={[]} onAdded={vi.fn()} onDone={vi.fn()} />),
  );
  await type(input("URL, command, or config"), "https://mcp.example.test/mcp");
  await click(button("Edit source"));
  expect(input("URL, command, or config").value).toBe("https://mcp.example.test/mcp");
  await click(button("Continue"));
  expect(input("Server name").value).toBe("Example");

  await click(button("Access token"));
  await click(button("Add server"));
  expect(container.textContent).toContain("Add an access token.");
  expect(rpc).not.toHaveBeenCalledWith("mcp/servers/create", expect.anything());
  await type(input("Access token"), "fake-token");
  await click(button("Add server"));
  expect(rpc).toHaveBeenCalledWith(
    "mcp/servers/create",
    expect.objectContaining({ endpoint: "https://mcp.example.test/mcp", secret: "fake-token" }),
  );
});
