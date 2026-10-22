import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const localConfig = path.join(root, ".env.local");
if (existsSync(localConfig)) process.loadEnvFile(localConfig);

const [platform, action, ...args] = process.argv.slice(2);
if (
  !["mac", "ios"].includes(platform) ||
  !["run", "build", "archive", "upload", "push"].includes(action) ||
  (platform === "mac" && !["run", "build"].includes(action))
) {
  throw new Error(
    "Usage: node scripts/local-app.mjs <mac|ios> <run|build|archive|upload|push> [Expo options]",
  );
}

// biome-ignore lint/suspicious/noUndeclaredEnvVars: this launcher runs directly, outside Turbo.
const serverUrl = process.env.RAKAZO_SERVER_URL;
if (serverUrl) {
  const url = new URL(serverUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("RAKAZO_SERVER_URL must be an HTTP(S) URL without credentials.");
  }
}

const env = { ...process.env, RAKAZO_LOCAL_BUILD: "1" };
if (serverUrl) {
  env.RAKAZO_WEB_URL = serverUrl;
  env.EXPO_PUBLIC_API_URL = serverUrl;
}

function run(command, commandArgs, cwd = root, environment = env) {
  const result = spawnSync(command, commandArgs, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (platform === "mac") {
  if (args.length) throw new Error("Mac commands do not take additional options.");
  run("pnpm", ["--filter", "@rakazo/web", "build"]);
  run("pnpm", ["--filter", "@rakazo/desktop", "build"]);
  if (action === "run") {
    run("pnpm", ["exec", "electron", "."], path.join(root, "apps/desktop"));
  } else {
    run(
      "pnpm",
      [
        "exec",
        "electron-builder",
        "--mac",
        "--dir",
        "--config",
        "electron-builder.local.mjs",
        "--publish",
        "never",
      ],
      path.join(root, "apps/desktop"),
    );
  }
} else {
  const mobileRoot = path.join(root, "apps/mobile");
  if (action === "push" && !env.RAKAZO_EXPO_PROJECT_ID) {
    if (!env.RAKAZO_IOS_BUNDLE_IDENTIFIER) {
      throw new Error("Set your own RAKAZO_IOS_BUNDLE_IDENTIFIER in .env.local before push setup.");
    }
    const temporaryRoot = path.join(root, ".tmp");
    mkdirSync(temporaryRoot, { recursive: true });
    const staging = mkdtempSync(path.join(temporaryRoot, "expo-push-setup-"));
    const mobilePackage = JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8"));
    writeFileSync(
      path.join(staging, "package.json"),
      JSON.stringify({
        name: "rakazo-local",
        private: true,
        dependencies: { expo: mobilePackage.dependencies.expo },
      }),
    );
    const stagedConfig = path.join(staging, "app.json");
    writeFileSync(
      stagedConfig,
      JSON.stringify({
        expo: {
          name: "Rakazo Local",
          slug: "rakazo-local",
          ios: { bundleIdentifier: env.RAKAZO_IOS_BUNDLE_IDENTIFIER },
        },
      }),
    );
    symlinkSync(path.join(mobileRoot, "node_modules"), path.join(staging, "node_modules"), "dir");
    // EAS can write project identifiers here without modifying tracked app configuration.
    run("eas", ["project:init"], staging);
    const projectId = JSON.parse(readFileSync(stagedConfig, "utf8")).expo?.extra?.eas?.projectId;
    if (
      typeof projectId !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)
    ) {
      throw new Error(
        "Expo did not return a project ID. Sign in with eas login, then retry push setup.",
      );
    }
    const existing = existsSync(localConfig) ? readFileSync(localConfig, "utf8") : "";
    const updated = existing.replace(/^RAKAZO_EXPO_PROJECT_ID=.*\n?/gm, "");
    writeFileSync(localConfig, `${updated}\nRAKAZO_EXPO_PROJECT_ID=${projectId}\n`, {
      mode: 0o600,
    });
    chmodSync(localConfig, 0o600);
    env.RAKAZO_EXPO_PROJECT_ID = projectId;
    rmSync(staging, { recursive: true });
  }
  const deviceOption = args.findIndex((arg) => arg === "--device" || arg === "-d");
  const physicalDevice = deviceOption !== -1 && args[deviceOption + 1] !== "generic";
  if (
    (physicalDevice || ["archive", "upload", "push"].includes(action)) &&
    !env.RAKAZO_EXPO_PROJECT_ID
  ) {
    throw new Error(
      "Set your own RAKAZO_EXPO_PROJECT_ID in .env.local before building for iPhone. See docs/local-apps.md for push setup.",
    );
  }
  if (action === "push") {
    if (args.length) throw new Error("Push setup does not take additional options.");
    run("eas", ["credentials", "--platform", "ios"], mobileRoot);
    process.exit(0);
  }
  const distributionRoot = path.join(mobileRoot, "build/local-testflight");
  const archivePath = path.join(distributionRoot, "RakazoLocal.xcarchive");
  if (action === "archive" || action === "upload") {
    if (args.length) throw new Error("Archive and upload commands do not take additional options.");
    if (!serverUrl || new URL(serverUrl).protocol !== "https:") {
      throw new Error("TestFlight builds require an HTTPS RAKAZO_SERVER_URL in .env.local.");
    }
    if (
      !env.RAKAZO_IOS_BUNDLE_IDENTIFIER ||
      !/^[A-Z0-9]{10}$/.test(env.RAKAZO_APPLE_TEAM_ID ?? "")
    ) {
      throw new Error(
        "Set your own RAKAZO_IOS_BUNDLE_IDENTIFIER and RAKAZO_APPLE_TEAM_ID in .env.local.",
      );
    }
  }
  if (action === "upload") {
    if (!existsSync(archivePath)) throw new Error("Run pnpm archive:ios before uploading.");
    const exportOptions = path.join(distributionRoot, "ExportOptions.plist");
    writeFileSync(
      exportOptions,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${env.RAKAZO_APPLE_TEAM_ID}</string>
<key>manageAppVersionAndBuildNumber</key><true/>
<key>testFlightInternalTestingOnly</key><true/>
</dict></plist>
`,
      { mode: 0o600 },
    );
    run("xcodebuild", [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportOptionsPlist",
      exportOptions,
      "-exportPath",
      distributionRoot,
      "-allowProvisioningUpdates",
    ]);
    process.exit(0);
  }
  // Validate the pinned SDK's bundled compatibility list, not changing online recommendations.
  run("pnpm", ["--filter", "@rakazo/mobile", "exec", "expo", "install", "--check"], root, {
    ...env,
    EXPO_OFFLINE: "1",
  });
  // Prebuild syncs the selected identity when switching from an upstream native project.
  run("pnpm", [
    "--filter",
    "@rakazo/mobile",
    "exec",
    "expo",
    "prebuild",
    "--platform",
    "ios",
    "--no-clean",
    ...(action === "archive" ? [] : ["--no-install"]),
  ]);
  if (action === "archive") {
    const workspaces = readdirSync(path.join(mobileRoot, "ios")).filter((name) =>
      name.endsWith(".xcworkspace"),
    );
    if (workspaces.length !== 1) throw new Error("Expected one generated iOS workspace.");
    const workspace = workspaces[0];
    mkdirSync(distributionRoot, { recursive: true });
    run(
      "xcodebuild",
      [
        "-workspace",
        path.join("ios", workspace),
        "-scheme",
        path.basename(workspace, ".xcworkspace"),
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archivePath,
        "-derivedDataPath",
        "build/local-device",
        "-allowProvisioningUpdates",
        "CODE_SIGN_STYLE=Automatic",
        "archive",
      ],
      mobileRoot,
    );
    process.exit(0);
  }
  const configuration = action === "build" ? ["--configuration", "Release", "--no-bundler"] : [];
  run("pnpm", ["--filter", "@rakazo/mobile", "exec", "expo", "run:ios", ...configuration, ...args]);
}
