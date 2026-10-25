import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerResourcesController } from "./computer-resources.js";

const GIB = 1024 ** 3;
const id = "a".repeat(64);
const otherId = "b".repeat(64);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-resources-"));
  temporary.push(dir);
  await writeFile(
    path.join(dir, ".env"),
    "POSTGRES_PASSWORD=fake-test-value\nRAKAZO_COMPUTER_MEMORY=2g\nRAKAZO_COMPUTER_CPUS=2\n",
  );
  const host = { Memory: 2 * GIB, NanoCpus: 2e9 };
  let usage = "1.25GiB / 2GiB";
  let authorized = true;
  const docker = vi.fn(async (args: string[]) => {
    let stdout = "";
    if (args[0] === "info") stdout = JSON.stringify({ MemTotal: 16 * GIB, NCPU: 8 });
    if (args[0] === "ps") stdout = `${id}\n${otherId}\n`;
    if (args[0] === "inspect")
      stdout = JSON.stringify([
        {
          Id: id,
          Config: {
            Labels: { "rakazo.managed": "true", "rakazo.botId": "team-home" },
            Env: ["SECRET=fake-private-value"],
          },
          Mounts: [{ Type: "volume", Name: "rakazo-desktop_appdata", Destination: "/home/rakazo" }],
          HostConfig: host,
          State: { Running: true, OOMKilled: true },
        },
        {
          Id: otherId,
          Config: { Labels: { "rakazo.managed": "true" } },
          Mounts: [{ Type: "volume", Name: "other-stack_appdata", Destination: "/home/rakazo" }],
        },
      ]);
    if (args[0] === "stats")
      stdout = JSON.stringify({ ID: id, MemUsage: usage, CPUPerc: "125.5%" });
    if (args[0] === "update") {
      host.Memory = Number(args[2]);
      host.NanoCpus = Number(args[6]) * 1e9;
    }
    return { code: 0, stdout, stderr: "" };
  });
  const controller = new ComputerResourcesController({
    stackDir: dir,
    docker,
    authorized: () => authorized,
  });
  return {
    dir,
    docker,
    controller,
    setUsage: (value: string) => {
      usage = value;
    },
    revoke: () => {
      authorized = false;
    },
  };
}

describe("local computer resources", () => {
  it("reports capacity, usage and memory pressure only for this managed stack", async () => {
    const { controller } = await fixture();
    const state = await controller.state();
    expect(state).toEqual({
      capacity: { memoryGiB: 16, cpuCores: 8 },
      defaults: { memoryGiB: 2, cpuCores: 2 },
      computers: [
        {
          id,
          shared: true,
          running: true,
          limits: { memoryGiB: 2, cpuCores: 2 },
          usage: { memoryGiB: 1.25, cpuCores: 1.255 },
          memoryKilled: true,
        },
      ],
    });
    expect(JSON.stringify(state)).not.toContain("fake-private-value");
  });

  it("persists defaults, reloads the supervisor, and updates only owned computers without restarting them", async () => {
    const { controller, docker, dir } = await fixture();
    const result = await controller.apply({ memoryGiB: 4, cpuCores: 4, applyToExisting: true });
    expect(result.defaults).toEqual({ memoryGiB: 4, cpuCores: 4 });
    expect(result.computers[0]?.limits).toEqual({ memoryGiB: 4, cpuCores: 4 });
    const commands = docker.mock.calls.map(([args]) => args);
    expect(commands).toContainEqual([
      "update",
      "--memory",
      String(4 * GIB),
      "--memory-swap",
      String(4 * GIB),
      "--cpus",
      "4",
      id,
    ]);
    expect(commands.some((args) => args[0] === "compose" && args.at(-1) === "supervisor")).toBe(
      true,
    );
    expect(commands.some((args) => args[0] === "stop" || args[0] === "restart")).toBe(false);
    expect(commands.filter((args) => args[0] === "update").flat()).not.toContain(otherId);
    const env = await readFile(path.join(dir, ".env"), "utf8");
    expect(env).toContain("POSTGRES_PASSWORD=fake-test-value\n");
    expect(env).toContain("RAKAZO_COMPUTER_MEMORY=4g\n");
    expect(env).toContain("RAKAZO_COMPUTER_CPUS=4\n");
  });

  it("can change defaults without modifying existing computers", async () => {
    const { controller, docker } = await fixture();
    await controller.apply({ memoryGiB: 4, cpuCores: 4, applyToExisting: false });
    expect(docker.mock.calls.some(([args]) => args[0] === "update")).toBe(false);
  });

  it("refuses to lower memory below usage and does not persist the unsafe change", async () => {
    const { controller, dir, docker } = await fixture();
    await expect(
      controller.apply({ memoryGiB: 1, cpuCores: 2, applyToExisting: true }),
    ).rejects.toThrow("Memory is in use");
    expect(await readFile(path.join(dir, ".env"), "utf8")).toContain("RAKAZO_COMPUTER_MEMORY=2g");
    expect(docker.mock.calls.some(([args]) => args[0] === "update" || args[0] === "compose")).toBe(
      false,
    );
  });

  it.each([
    { memoryGiB: 32, cpuCores: 4, applyToExisting: false },
    { memoryGiB: 4, cpuCores: 16, applyToExisting: false },
    { memoryGiB: 0, cpuCores: 0, applyToExisting: true },
  ])("refuses invalid or excessive limits %j", async (settings) => {
    const { controller, docker } = await fixture();
    await expect(controller.apply(settings)).rejects.toThrow();
    expect(docker.mock.calls.some(([args]) => args[0] === "update" || args[0] === "compose")).toBe(
      false,
    );
  });

  it("restores saved defaults after a failed supervisor reload so the change can be retried", async () => {
    const { controller, docker, dir } = await fixture();
    const original = docker.getMockImplementation()!;
    docker.mockImplementation(async (args) =>
      args[0] === "compose"
        ? { code: 1, stdout: "", stderr: "fake-private-error" }
        : original(args),
    );
    await expect(
      controller.apply({ memoryGiB: 4, cpuCores: 4, applyToExisting: true }),
    ).rejects.toThrow("Docker could not complete");
    expect(await readFile(path.join(dir, ".env"), "utf8")).toContain("RAKAZO_COMPUTER_MEMORY=2g");
    expect(docker.mock.calls.some(([args]) => args[0] === "update")).toBe(false);
    docker.mockImplementation(original);
    await expect(
      controller.apply({ memoryGiB: 4, cpuCores: 4, applyToExisting: true }),
    ).resolves.toMatchObject({ defaults: { memoryGiB: 4, cpuCores: 4 } });
  });

  it("does not expose malformed Docker output in errors", async () => {
    const { controller, docker } = await fixture();
    const original = docker.getMockImplementation()!;
    docker.mockImplementation(async (args) =>
      args[0] === "info" ? { code: 0, stdout: "fake-private-value", stderr: "" } : original(args),
    );
    await expect(controller.state()).rejects.toThrow(
      "Docker returned invalid resource information.",
    );
  });

  it("stops Docker access after the managed instance changes", async () => {
    const { controller, docker, revoke } = await fixture();
    revoke();
    await expect(
      controller.apply({ memoryGiB: 4, cpuCores: 4, applyToExisting: true }),
    ).rejects.toThrow("managed local instance");
    expect(docker).not.toHaveBeenCalled();
  });
});
