import type { ConfigContext, ExpoConfig } from "expo/config";

const RELEASE_PROFILES = new Set(["production", "android-apk", "diagnostic"]);

export default ({ config }: ConfigContext): ExpoConfig => {
  if (RELEASE_PROFILES.has(process.env.EAS_BUILD_PROFILE ?? "")) {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      throw new Error(
        "EXPO_PUBLIC_API_URL must be set in the EAS production environment before building a release.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(apiUrl);
    } catch {
      throw new Error("EXPO_PUBLIC_API_URL must be a valid URL.");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("EXPO_PUBLIC_API_URL must use HTTPS for production builds.");
    }
  }

  let result = config as ExpoConfig;
  const localBuild = process.env.RAKAZO_LOCAL_BUILD === "1";
  if (localBuild) {
    const projectId = process.env.RAKAZO_EXPO_PROJECT_ID;
    if (projectId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
      throw new Error("RAKAZO_EXPO_PROJECT_ID must be your Expo project's UUID.");
    }
    if (projectId && projectId === config.extra?.eas?.projectId) {
      throw new Error("Local builds must use your own Expo project, not the release project.");
    }
    const { eas: _eas, ...extra } = result.extra ?? {};
    result = {
      ...result,
      name: "Rakazo Local",
      slug: "rakazo-local",
      owner: undefined,
      scheme: "rakazo-local",
      plugins: ["./plugins/with-local-signing", ...(result.plugins ?? [])],
      updates: { enabled: false },
      extra: { ...extra, ...(projectId ? { eas: { projectId } } : {}) },
      ios: {
        ...result.ios,
        bundleIdentifier: process.env.RAKAZO_IOS_BUNDLE_IDENTIFIER ?? "dev.rakazo.local",
        ...(process.env.RAKAZO_APPLE_TEAM_ID
          ? { appleTeamId: process.env.RAKAZO_APPLE_TEAM_ID }
          : {}),
        associatedDomains: [],
      },
      android: { ...result.android, package: "dev.rakazo.local" },
    };
  }
  const rpId = localBuild ? null : passkeyRpId(process.env.EXPO_PUBLIC_API_URL);
  if (rpId) {
    // Native passkeys only work for domains the binary is associated with, so the app reads the
    // same list at runtime to hide passkeys on other servers.
    result = {
      ...result,
      ios: {
        ...result.ios,
        associatedDomains: [...(result.ios?.associatedDomains ?? []), `webcredentials:${rpId}`],
      },
      extra: { ...result.extra, passkeyRpIds: [rpId] },
    };
  }

  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesFile) {
    result = { ...result, android: { ...result.android, googleServicesFile } };
  }

  // Native crash handling autolinks; upload build hooks are optional and require credentials.
  if (process.env.SENTRY_AUTH_TOKEN) {
    result = {
      ...result,
      plugins: [
        ...(result.plugins ?? []),
        [
          "@sentry/react-native/expo",
          {
            organization: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            url: process.env.SENTRY_URL,
          },
        ],
      ],
    };
  }
  return result;
};

/** The default server's host when native passkeys can use it: HTTPS and a domain name. */
function passkeyRpId(apiUrl: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(apiUrl ?? "");
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host.includes(".")) return null;
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return null;
  return host;
}
