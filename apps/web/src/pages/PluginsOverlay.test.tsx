// @vitest-environment jsdom

import type { Connection, ConnectionCatalogItem } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  connections: {
    catalog: vi.fn(),
    list: vi.fn(),
    tools: vi.fn(),
    rename: vi.fn(),
    revoke: vi.fn(),
  },
  capabilities: { list: vi.fn(), catalogSearch: vi.fn() },
  mcp: { servers: { list: vi.fn() } },
}));

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: ({ value, other }: { value: number; other: string }) => other.replace("#", `${value}`),
  };
});
vi.mock("../lib/rpc", () => ({ rpc }));

import { PluginsOverlay } from "./PluginsOverlay";

const gmailLogo = "https://logos.example.test/gmail.svg";
const catalog: ConnectionCatalogItem[] = [
  {
    connectorId: "managed",
    slug: "gmail",
    name: "Gmail",
    logo: gmailLogo,
    connected: true,
    noAuth: false,
  },
  {
    connectorId: "managed",
    slug: "linear",
    name: "Linear",
    logo: null,
    connected: false,
    noAuth: false,
  },
];
const account = (id: string, displayName: string): Connection => ({
  id,
  connectorId: "managed",
  provider: "gmail",
  displayName,
  status: "connected",
  capabilities: [],
  createdAt: "2026-01-01T00:00:00.000Z",
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rpc.connections.catalog.mockResolvedValue(catalog);
  rpc.connections.list.mockResolvedValue([account("c1", "Personal"), account("c2", "Work")]);
  rpc.connections.tools.mockResolvedValue([{ name: "GMAIL_SEND_EMAIL", description: "" }]);
  rpc.connections.rename.mockImplementation(async ({ displayName }) => ({ displayName }));
  rpc.connections.revoke.mockResolvedValue(undefined);
  rpc.capabilities.list.mockResolvedValue([]);
  rpc.capabilities.catalogSearch.mockResolvedValue({ enabled: false, results: [] });
  rpc.mcp.servers.list.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const dialogs = () => document.querySelectorAll('[role="dialog"]');
const detail = () => document.querySelector('[data-testid="connection-detail"]');
const list = () => document.getElementById("integration-list");
const search = () => document.querySelector<HTMLInputElement>('input[aria-label="Search apps"]');

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === name,
  );
  if (!match) throw new Error(`Missing button ${name}`);
  return match;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeSearch(value: string) {
  const input = search();
  if (!input) throw new Error("Missing search");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openGmail(onClose = vi.fn()) {
  await act(async () => root.render(<PluginsOverlay onClose={onClose} />));
  await click(button("Connected integrations"));
  await typeSearch("work");
  const scroller = list();
  if (!scroller) throw new Error("Missing list");
  scroller.scrollTop = 120;
  const tile = document.querySelector('[data-testid="connection-tile-gmail"] button');
  if (!tile) throw new Error("Missing Gmail tile");
  await click(tile);
  return { onClose, scroller, tile };
}

it("opens integration detail inside the same dialog and returns to the filtered list", async () => {
  const { scroller, tile } = await openGmail();

  expect(dialogs()).toHaveLength(1);
  expect(detail()?.closest('[role="dialog"]')).toBe(dialogs()[0]);
  expect(scroller.hidden).toBe(true);
  expect(search()).toBeNull();
  expect(document.activeElement).toBe(button("Back to connected integrations"));
  expect(detail()?.querySelector("h2")?.textContent).toBe("Gmail");
  expect(detail()?.querySelector("img")?.getAttribute("src")).toBe(gmailLogo);
  expect(
    [
      ...(detail()?.querySelectorAll<HTMLInputElement>('input[aria-label="Account label"]') ?? []),
    ].map((input) => input.value),
  ).toEqual(["Personal", "Work"]);

  await click(button("Back to connected integrations"));

  expect(detail()).toBeNull();
  expect(dialogs()).toHaveLength(1);
  expect(search()?.value).toBe("work");
  expect(scroller.hidden).toBe(false);
  expect(scroller.scrollTop).toBe(120);
  expect(document.activeElement).toBe(tile);
});

it("backs out of the detail on Escape without closing the dialog", async () => {
  const { onClose } = await openGmail();

  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

  expect(detail()).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(search()?.value).toBe("work");

  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps account management and errors on the detail page", async () => {
  await openGmail();

  rpc.connections.revoke.mockRejectedValueOnce(new Error("Revoke failed"));
  await click(button("Remove"));
  expect(detail()?.textContent).toContain("Revoke failed");

  await click(button("Uninstall"));
  expect(rpc.connections.revoke).toHaveBeenCalledTimes(3);
  expect(detail()).toBeNull();
  expect(search()?.value).toBe("work");
});
