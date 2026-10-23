import { describe, expect, it } from "vitest";

import {
  appendConnectorIntent,
  buildComposerMentionOptions,
  connectorIntentLine,
  mentionChipKey,
  mentionPickerConnectors,
  partitionComposerMentions,
  resolveComposerSendPlan,
  routineScheduleSubtitle,
  searchComposerMentions,
  stripMentionKinds,
  stripMentionToken,
  toThreadMentionPayload,
} from "./composer-mentions.js";

describe("buildComposerMentionOptions", () => {
  it("lists bots groups routines connectors and everyone", () => {
    const options = buildComposerMentionOptions({
      query: "",
      includeEveryone: true,
      bots: [{ id: "b1", name: "Chief", color: "#111" }],
      groups: [{ id: "g1", name: "Planning" }],
      routines: [
        {
          id: "r1",
          name: "Daily digest",
          crons: ["0 9 * * 1-5"],
          botId: "b1",
          botName: "Chief",
        },
      ],
      connectors: [
        {
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
        { id: "catalog:stripe", name: "Stripe", authStatus: "needs_auth" },
      ],
    });
    expect(options.map((option) => option.kind)).toEqual([
      "everyone",
      "bot",
      "group",
      "routine",
      "connector",
      "connector",
    ]);
    expect(options.find((option) => option.kind === "bot")?.subtitle).toBe("Bot");
    expect(options.find((option) => option.name === "Gmail")?.subtitle).toBe("Connected");
    expect(options.find((option) => option.name === "Stripe")?.subtitle).toBe("Needs auth");
    expect(options.find((option) => option.kind === "routine")?.subtitle).toMatch(/Weekdays/i);
  });

  it("disambiguates same-name routines with bot name", () => {
    const options = buildComposerMentionOptions({
      query: "daily",
      bots: [],
      groups: [],
      routines: [
        {
          id: "r1",
          name: "Daily",
          crons: ["0 9 * * *"],
          botId: "b1",
          botName: "Chief",
        },
        {
          id: "r2",
          name: "Daily",
          crons: ["0 10 * * *"],
          botId: "b2",
          botName: "Writer",
        },
      ],
      connectors: [],
    });
    expect(options).toHaveLength(2);
    expect(options[0]?.subtitle).toContain("Chief");
    expect(options[1]?.subtitle).toContain("Writer");
    expect(mentionChipKey(options[0]!)).toBe("routine:r1");
    expect(mentionChipKey(options[1]!)).toBe("routine:r2");
  });

  it("skips the current group", () => {
    const options = buildComposerMentionOptions({
      query: "",
      currentGroupId: "g1",
      bots: [],
      groups: [
        { id: "g1", name: "Here" },
        { id: "g2", name: "Elsewhere" },
      ],
      routines: [],
      connectors: [],
    });
    expect(options.map((option) => option.id)).toEqual(["g2"]);
  });

  it("filters by query before applying limit so later kinds stay reachable", () => {
    const bots = Array.from({ length: 40 }, (_, index) => ({
      id: `b${index}`,
      name: `Bot${index}`,
    }));
    const options = buildComposerMentionOptions({
      query: "gmail",
      bots,
      groups: [],
      routines: [],
      connectors: [
        {
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
        { id: "c2", name: "Granola", authStatus: "needs_auth" },
      ],
      limit: 10,
    });
    expect(options.map((option) => option.name)).toEqual(["Gmail"]);
  });

  it("returns the full catalog when limit is omitted", () => {
    const bots = Array.from({ length: 80 }, (_, index) => ({
      id: `b${index}`,
      name: `Bot${index}`,
    }));
    const options = buildComposerMentionOptions({
      query: "",
      bots,
      groups: [],
      routines: [],
      connectors: [
        {
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
      ],
    });
    expect(options).toHaveLength(81);
    expect(options.at(-1)?.name).toBe("Gmail");
  });
});

describe("mentionPickerConnectors", () => {
  const connection = (id: string, provider: string, displayName: string) => ({
    id,
    connectorId: "managed",
    provider,
    displayName,
    status: "connected" as const,
    capabilities: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const catalogItem = (slug: string, name: string, logo: string | null) => ({
    connectorId: "managed",
    slug,
    name,
    logo,
    connected: false,
    noAuth: false,
  });

  it("gives every connected profile its app logo and keeps its own name and id", () => {
    const options = mentionPickerConnectors(
      [
        connection("c1", "gmail", "Gmail"),
        connection("c2", "GMAIL", "Work"),
        connection("c3", "custom", "Notes"),
      ],
      [
        catalogItem("gmail", "Gmail", "https://logos.example/gmail.svg"),
        catalogItem("linear", "Linear", null),
      ],
    );
    expect(options).toEqual([
      {
        id: "c1",
        name: "Gmail",
        authStatus: "connected",
        connectionId: "c1",
        logo: "https://logos.example/gmail.svg",
      },
      {
        id: "c2",
        name: "Work",
        authStatus: "connected",
        connectionId: "c2",
        logo: "https://logos.example/gmail.svg",
      },
      {
        id: "c3",
        name: "Notes",
        authStatus: "connected",
        connectionId: "c3",
        logo: null,
      },
      {
        id: "catalog:managed:linear",
        name: "Linear",
        authStatus: "needs_auth",
        logo: null,
      },
    ]);
  });

  it("carries the logo into the picker option for each profile", () => {
    const options = buildComposerMentionOptions({
      query: "",
      bots: [],
      groups: [],
      routines: [],
      connectors: mentionPickerConnectors(
        [connection("c1", "gmail", "Gmail"), connection("c2", "gmail", "Work")],
        [catalogItem("gmail", "Gmail", "https://logos.example/gmail.svg")],
      ),
    });
    expect(options.map(({ id, name, logo }) => ({ id, name, logo }))).toEqual([
      { id: "c1", name: "Gmail", logo: "https://logos.example/gmail.svg" },
      { id: "c2", name: "Work", logo: "https://logos.example/gmail.svg" },
    ]);
    expect(toThreadMentionPayload(options)).toEqual([
      { kind: "connector", id: "c1" },
      { kind: "connector", id: "c2" },
    ]);
  });
});

describe("resolveComposerSendPlan", () => {
  it("opens a chip-only @Group from a 1:1 without sending", () => {
    const plan = resolveComposerSendPlan({
      text: "@Planning",
      mentions: [{ kind: "group", id: "g1", name: "Planning" }],
      hasAttachments: false,
    });
    expect(plan.isNoOp).toBe(false);
    expect(plan.shouldSend).toBe(false);
    expect(plan.shouldOpenGroup).toBe(true);
    expect(plan.rerouteGroupId).toBe("g1");
    expect(plan.trimmed).toBe("");
  });

  it("sends leftover text into the mentioned group", () => {
    const plan = resolveComposerSendPlan({
      text: "@Planning follow up",
      mentions: [{ kind: "group", id: "g1", name: "Planning" }],
      hasAttachments: false,
    });
    expect(plan.shouldSend).toBe(true);
    expect(plan.shouldOpenGroup).toBe(true);
    expect(plan.trimmed).toBe("follow up");
  });

  it("runs routines then opens the group when both chips have no text", () => {
    const plan = resolveComposerSendPlan({
      text: "@Planning @Digest",
      mentions: [
        { kind: "group", id: "g1", name: "Planning" },
        { kind: "routine", id: "r1", name: "Digest" },
      ],
      hasAttachments: false,
    });
    expect(plan.shouldRunRoutines).toBe(true);
    expect(plan.routineIds).toEqual(["r1"]);
    expect(plan.shouldOpenGroup).toBe(true);
    expect(plan.shouldSend).toBe(false);
    expect(plan.isNoOp).toBe(false);
  });

  it("opens another group from inside a group thread", () => {
    const plan = resolveComposerSendPlan({
      text: "@Other",
      mentions: [{ kind: "group", id: "g2", name: "Other" }],
      hasAttachments: false,
    });
    expect(plan.shouldOpenGroup).toBe(true);
    expect(plan.rerouteGroupId).toBe("g2");
    expect(plan.shouldSend).toBe(false);
    expect(plan.isNoOp).toBe(false);
  });
});

describe("partition and payload", () => {
  it("partitions typed mentions", () => {
    const parts = partitionComposerMentions([
      { kind: "bot", id: "b1", name: "Chief" },
      { kind: "group", id: "g1", name: "Planning" },
      { kind: "routine", id: "r1", name: "Digest" },
      {
        kind: "connector",
        id: "c1",
        name: "Gmail",
        authStatus: "connected",
        connectionId: "c1",
      },
      { kind: "everyone", id: "everyone", name: "everyone" },
    ]);
    expect(parts.bots).toHaveLength(1);
    expect(parts.groups).toHaveLength(1);
    expect(parts.routines).toHaveLength(1);
    expect(parts.connectors).toHaveLength(1);
    expect(parts.everyone).toBe(true);
  });

  it("omits needs-auth catalog connectors from API payload", () => {
    expect(
      toThreadMentionPayload([
        { kind: "bot", id: "b1", name: "Chief" },
        {
          kind: "connector",
          id: "catalog:stripe",
          name: "Stripe",
          authStatus: "needs_auth",
        },
        {
          kind: "connector",
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
      ]),
    ).toEqual([
      { kind: "bot", id: "b1" },
      { kind: "connector", id: "c1" },
    ]);
  });
});

describe("strip and connector intent", () => {
  it("strips selected mention kinds from prompt text", () => {
    expect(
      stripMentionKinds(
        "@Planning @Chief check this",
        [
          { kind: "group", name: "Planning" },
          { kind: "bot", name: "Chief" },
        ],
        ["group"],
      ),
    ).toBe("@Chief check this");
  });

  it("strips multi-word mention tokens", () => {
    expect(stripMentionToken("Ask @Draft team please", "Draft team")).toBe("Ask please");
  });

  it("preserves newlines when stripping mention tokens", () => {
    expect(stripMentionToken("@Planning\n\nline two", "Planning")).toBe("line two");
    expect(stripMentionToken("one\n@Planning\ntwo", "Planning")).toBe("one\n\ntwo");
  });

  it("builds connector intent lines", () => {
    expect(connectorIntentLine(["Gmail", "Stripe"])).toBe(
      "Use these connectors if relevant: Gmail, Stripe.",
    );
    expect(appendConnectorIntent("check inbox", ["Gmail"])).toBe(
      "check inbox\n\nUse these connectors if relevant: Gmail.",
    );
    expect(appendConnectorIntent("", ["Gmail"])).toBe("Use these connectors if relevant: Gmail.");
  });

  it("formats routine subtitles", () => {
    expect(routineScheduleSubtitle(["0 9 * * 1-5"])).toMatch(/Weekdays/i);
    expect(routineScheduleSubtitle(["0 9 * * 1-5"], "Chief")).toContain("Chief");
  });
});

it("searches the readable fallback when a mention name is opaque", () => {
  expect(
    buildComposerMentionOptions({
      query: "bot",
      bots: [{ id: "bot-1", name: "__TestTok1__" }],
      groups: [],
      routines: [],
      connectors: [],
    }),
  ).toEqual([
    {
      kind: "bot",
      id: "bot-1",
      name: "Bot",
      subtitle: "Bot",
      color: undefined,
    },
  ]);
});

describe("mention search relevance", () => {
  const mentions = [
    { kind: "bot" as const, id: "bot-slack", name: "Slackbot" },
    {
      kind: "connector" as const,
      id: "catalog-slack",
      name: "Slack",
      authStatus: "needs_auth" as const,
    },
    {
      kind: "connector" as const,
      id: "work",
      name: "visor-slack",
      authStatus: "connected" as const,
    },
    { kind: "bot" as const, id: "partial", name: "MySlackHelper" },
  ];

  it("ranks a complete profile word above a bot prefix and applies the limit afterward", () => {
    expect(searchComposerMentions(mentions, "slack").map((item) => item.id)).toEqual([
      "work",
      "bot-slack",
      "partial",
      "catalog-slack",
    ]);
    expect(searchComposerMentions(mentions, "slack", 1).map((item) => item.id)).toEqual(["work"]);
  });

  it("keeps exact bot names ahead of partial profiles and connected profiles win ties", () => {
    const exact = { kind: "bot" as const, id: "exact", name: "Slack" };
    expect(searchComposerMentions([exact, ...mentions], "slack")[0]?.id).toBe("exact");
    expect(
      searchComposerMentions(
        [exact, { ...exact, id: "connected", kind: "connector", authStatus: "connected" }],
        "slack",
      )[0]?.id,
    ).toBe("connected");
  });

  it("finds words across separators regardless of case or accents without changing empty-query order", () => {
    const profiles = [
      {
        kind: "connector" as const,
        id: "work",
        name: "Vísor-Slack team",
        authStatus: "connected" as const,
      },
    ];
    expect(searchComposerMentions(profiles, " SLACK visor ")).toEqual(profiles);
    expect(searchComposerMentions(profiles, "slack calendar")).toEqual([]);
    expect(searchComposerMentions(mentions, "")).toEqual(mentions);
  });
});

it("offers enabled MCP servers separately and sends their intent without connection-only IDs", () => {
  const connectors = mentionPickerConnectors(
    [],
    [],
    [
      { id: "notes", slug: "work-notes", name: "Work Notes", enabled: true },
      { id: "off", slug: "disabled", name: "Disabled", enabled: false },
    ],
  );
  const options = buildComposerMentionOptions({
    query: "notes",
    bots: [],
    groups: [],
    routines: [],
    connectors,
  });
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({
    kind: "connector",
    id: "mcp:notes",
    mcpServerId: "notes",
    name: "Work Notes",
    subtitle: "MCP server",
  });
  const plan = resolveComposerSendPlan({
    text: "@Work Notes Find my draft",
    mentions: options,
    hasAttachments: false,
  });
  expect(plan.trimmed).toBe("Find my draft\n\nUse these connectors if relevant: Work Notes.");
  expect(plan.mentionPayload).toEqual([]);
  expect(plan.shouldSend).toBe(true);
});
