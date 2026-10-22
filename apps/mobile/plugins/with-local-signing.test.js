import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { withEntitlementsPlist } = require("expo/config-plugins");
const withLocalSigning = require("./with-local-signing.js");

it("keeps push signing while removing the release's domain associations", async () => {
  const config = withEntitlementsPlist(
    withLocalSigning({ name: "Local", slug: "local" }),
    (cfg) => {
      cfg.modResults["aps-environment"] = "development";
      cfg.modResults["com.apple.developer.associated-domains"] = ["webcredentials:example.com"];
      return cfg;
    },
  );
  const result = await config.mods.ios.entitlements({
    ...config,
    modResults: { "com.apple.security.application-groups": ["group.example.local"] },
    modRequest: {},
  });
  expect(result.modResults).toEqual({
    "com.apple.security.application-groups": ["group.example.local"],
    "aps-environment": "development",
  });
});
