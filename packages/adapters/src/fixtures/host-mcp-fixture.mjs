import { appendFileSync, writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

if (process.env.FIXTURE_LAUNCHES) appendFileSync(process.env.FIXTURE_LAUNCHES, `${process.pid}\n`);
if (process.env.FIXTURE_FAIL) {
  process.stderr.write(process.env.FIXTURE_SECRET);
  process.exit(1);
}
const server = new Server(
  { name: "offline-fixture", version: "1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const args = request.params.arguments ?? {};
  if (args.wait) {
    if (process.env.FIXTURE_STARTED) writeFileSync(process.env.FIXTURE_STARTED, "started");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      extra.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          args,
          configured: process.env.FIXTURE_SECRET,
          inherited: process.env.RAKAZO_TEST_BACKEND_SECRET ?? null,
          pid: process.pid,
        }),
      },
    ],
    isError: args.fail === true,
  };
});
if (process.env.FIXTURE_SLOW) await new Promise((resolve) => setTimeout(resolve, 60_000));
await server.connect(new StdioServerTransport());
