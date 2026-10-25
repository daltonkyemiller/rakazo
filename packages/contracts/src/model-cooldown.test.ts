import { expect, it } from "vitest";
import { modelCooldown } from "./model-cooldown.js";

it("reads a rejected model retry delay with or without spacing", () => {
  expect(modelCooldown("Server requested 3158s retry delay (max: 60s). 429")).toEqual({
    requestedMs: 3158000,
    maximumMs: 60000,
  });
  expect(modelCooldown("Server requested 60.5s retry delay (max:60s).")).toEqual({
    requestedMs: 60500,
    maximumMs: 60000,
  });
});

it.each([
  "429 rate_limit_error",
  "Server requested NaNs retry delay (max: 60s)",
  "Server requested 1s retry delay (max:60s)",
  "Server requested 999999999999999999999999s retry delay (max:60s)",
])("does not infer a cooldown from %s", (diagnostic) => {
  expect(modelCooldown(diagnostic)).toBeUndefined();
});
