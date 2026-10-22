import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
  fixtures.length = 0;
});

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "rakazo-local-build-")));
  fixtures.push(root);
  const bin = path.join(root, "bin");
  const script = path.join(root, "scripts/local-app.mjs");
  const log = path.join(root, "commands.jsonl");
  mkdirSync(bin);
  mkdirSync(path.dirname(script));
  mkdirSync(path.join(root, "apps/mobile/ios/RakazoLocal.xcworkspace"), { recursive: true });
  writeFileSync(
    path.join(root, "apps/mobile/package.json"),
    JSON.stringify({ dependencies: { expo: "57.0.31" } }),
  );
  copyFileSync(new URL("../../../scripts/local-app.mjs", import.meta.url), script);
  for (const command of ["pnpm", "xcodebuild", "eas"]) {
    writeFileSync(
      path.join(bin, command),
      `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--check") && process.env.EXPO_OFFLINE !== "1") process.exit(2);
fs.appendFileSync(process.env.RAKAZO_BUILD_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "project:init") {
  const config = JSON.parse(fs.readFileSync("app.json", "utf8"));
  config.expo.extra = { eas: { projectId: "00000000-0000-4000-8000-000000000001" } };
  fs.writeFileSync("app.json", JSON.stringify(config));
}
`,
      { mode: 0o755 },
    );
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    RAKAZO_SERVER_URL: "https://server.example.test",
    RAKAZO_IOS_BUNDLE_IDENTIFIER: "com.example.rakazo.local",
    RAKAZO_APPLE_TEAM_ID: "TEAM123456",
    RAKAZO_EXPO_PROJECT_ID: "00000000-0000-4000-8000-000000000001",
    RAKAZO_BUILD_TEST_LOG: log,
  };
  return { root, script, log, env };
}

it("archives a Release build for generic iOS without a connected device or Metro", () => {
  const { root, script, log, env } = fixture();
  const result = spawnSync(process.execPath, [script, "ios", "archive"], { env, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const commands: string[][] = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(commands[1]).toContain("--no-clean");
  expect(commands[2]).toEqual([
    "-workspace",
    "ios/RakazoLocal.xcworkspace",
    "-scheme",
    "RakazoLocal",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    path.join(root, "apps/mobile/build/local-testflight/RakazoLocal.xcarchive"),
    "-derivedDataPath",
    "build/local-device",
    "-allowProvisioningUpdates",
    "CODE_SIGN_STYLE=Automatic",
    "archive",
  ]);
});

it("limits uploads to internal TestFlight and lets Xcode manage build numbers", () => {
  const { root, script, log, env } = fixture();
  const distribution = path.join(root, "apps/mobile/build/local-testflight");
  mkdirSync(path.join(distribution, "RakazoLocal.xcarchive"), { recursive: true });
  const result = spawnSync(process.execPath, [script, "ios", "upload"], { env, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const options = readFileSync(path.join(distribution, "ExportOptions.plist"), "utf8");
  expect(options).toContain("<key>destination</key><string>upload</string>");
  expect(options).toContain("<key>method</key><string>app-store-connect</string>");
  expect(options).toContain("<key>testFlightInternalTestingOnly</key><true/>");
  expect(options).toContain("<key>manageAppVersionAndBuildNumber</key><true/>");
  const commands: string[][] = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(commands).toHaveLength(1);
  expect(commands[0]?.[0]).toBe("-exportArchive");
});

it("rejects cleartext TestFlight endpoints before invoking any build tools", () => {
  const { script, env } = fixture();
  const result = spawnSync(process.execPath, [script, "ios", "archive"], {
    env: { ...env, RAKAZO_SERVER_URL: "http://127.0.0.1:45173" },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("TestFlight builds require an HTTPS RAKAZO_SERVER_URL");
});

it("blocks physical iPhone builds without a push project", () => {
  const { script, env } = fixture();
  const result = spawnSync(process.execPath, [script, "ios", "build", "--device"], {
    env: { ...env, RAKAZO_EXPO_PROJECT_ID: undefined },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Set your own RAKAZO_EXPO_PROJECT_ID");
});

it("sets up a private push project without rewriting the release app configuration", () => {
  const { root, script, log, env } = fixture();
  const releaseConfig = JSON.stringify({ expo: { name: "Release", slug: "release" } });
  const configPath = path.join(root, "apps/mobile/app.json");
  writeFileSync(configPath, releaseConfig);
  const result = spawnSync(process.execPath, [script, "ios", "push"], {
    env: { ...env, RAKAZO_EXPO_PROJECT_ID: undefined },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(configPath, "utf8")).toBe(releaseConfig);
  expect(readFileSync(path.join(root, ".env.local"), "utf8")).toContain(
    "RAKAZO_EXPO_PROJECT_ID=00000000-0000-4000-8000-000000000001",
  );
  const commands: string[][] = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(commands).toEqual([["project:init"], ["credentials", "--platform", "ios"]]);
});
