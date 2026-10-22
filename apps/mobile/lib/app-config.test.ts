import type { ConfigContext, ExpoConfig } from "expo/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appConfig from "../app.config";

beforeEach(() => {
  vi.stubEnv("RAKAZO_LOCAL_BUILD", undefined);
  vi.stubEnv("RAKAZO_EXPO_PROJECT_ID", undefined);
  vi.stubEnv("EAS_BUILD_PROFILE", "production");
  vi.stubEnv("EXPO_PUBLIC_API_URL", "https://app.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const config: ExpoConfig = {
  name: "Example",
  slug: "example",
  android: { package: "com.example.app", permissions: ["POST_NOTIFICATIONS"] },
  ios: { bundleIdentifier: "com.example.app" },
  extra: { example: true },
};

function context(config: ExpoConfig): ConfigContext {
  return { config, projectRoot: "/project", staticConfigPath: null, packageJsonPath: null };
}

const passkeys = {
  ios: { ...config.ios, associatedDomains: ["webcredentials:app.example.com"] },
  extra: { ...config.extra, passkeyRpIds: ["app.example.com"] },
};

describe("mobile app config", () => {
  it("attributes local push tokens to the local Expo project without enabling OTA updates", () => {
    vi.stubEnv("RAKAZO_LOCAL_BUILD", "1");
    vi.stubEnv("RAKAZO_EXPO_PROJECT_ID", "00000000-0000-4000-8000-000000000001");
    const result = appConfig(context(config));
    expect(result.extra?.eas).toEqual({ projectId: "00000000-0000-4000-8000-000000000001" });
    expect(result.updates).toEqual({ enabled: false });
  });

  it("refuses to register local push tokens against the release's Expo project", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    vi.stubEnv("RAKAZO_LOCAL_BUILD", "1");
    vi.stubEnv("RAKAZO_EXPO_PROJECT_ID", projectId);
    expect(() => appConfig(context({ ...config, extra: { eas: { projectId } } }))).toThrow(
      "Local builds must use your own Expo project",
    );
  });

  it("isolates local builds from release identities, passkeys and OTA updates", () => {
    vi.stubEnv("RAKAZO_LOCAL_BUILD", "1");
    const result = appConfig(
      context({
        ...config,
        owner: "example-owner",
        scheme: "rakazo",
        extra: { ...config.extra, eas: { projectId: "example-project" } },
        updates: { url: "https://updates.example.com" },
      }),
    );
    expect(result.name).toBe("Rakazo Local");
    expect(result.scheme).toBe("rakazo-local");
    expect(result.ios?.bundleIdentifier).toBe("dev.rakazo.local");
    expect(result.ios?.associatedDomains).toEqual([]);
    expect(result.updates).toEqual({ enabled: false });
    expect(result.extra).toEqual({ example: true });
    expect(result.owner).toBeUndefined();
  });

  it("loads the Firebase file path while preserving the existing config", () => {
    vi.stubEnv("GOOGLE_SERVICES_JSON", "/build/google-services.json");

    expect(appConfig(context(config))).toEqual({
      ...config,
      ...passkeys,
      android: { ...config.android, googleServicesFile: "/build/google-services.json" },
    });
    expect(config.android).not.toHaveProperty("googleServicesFile");
  });

  it("leaves the config unchanged when no variable applies", () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "development");
    vi.stubEnv("EXPO_PUBLIC_API_URL", undefined);
    vi.stubEnv("GOOGLE_SERVICES_JSON", undefined);
    const existing = {
      ...config,
      android: { ...config.android, googleServicesFile: "./custom-google-services.json" },
    };

    expect(appConfig(context(existing))).toBe(existing);
    expect(appConfig(context(config))).toBe(config);
  });

  it("adds Android config when none exists", () => {
    vi.stubEnv("GOOGLE_SERVICES_JSON", "/build/google-services.json");
    const { android: _android, ...withoutAndroid } = config;

    expect(appConfig(context(withoutAndroid))).toEqual({
      ...withoutAndroid,
      ...passkeys,
      android: { googleServicesFile: "/build/google-services.json" },
    });
  });

  it("associates the default server's domain for passkeys and keeps other domains", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://App.Example.com:8443/api");
    const existing = { ...config, ios: { ...config.ios, associatedDomains: ["applinks:x.test"] } };

    expect(appConfig(context(existing))).toEqual({
      ...config,
      ios: {
        ...config.ios,
        associatedDomains: ["applinks:x.test", "webcredentials:app.example.com"],
      },
      extra: { ...config.extra, passkeyRpIds: ["app.example.com"] },
    });
  });

  it.each([
    "http://app.example.com",
    "https://localhost:3100",
    "https://192.168.1.20",
    "https://[::1]",
    "not a url",
  ])("skips passkey domains for %s", (url) => {
    vi.stubEnv("EAS_BUILD_PROFILE", "development");
    vi.stubEnv("EXPO_PUBLIC_API_URL", url);
    vi.stubEnv("GOOGLE_SERVICES_JSON", undefined);

    expect(appConfig(context(config))).toBe(config);
  });
});
