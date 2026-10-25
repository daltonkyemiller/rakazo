import path from "node:path";
import type { ComputerResourceLimits, ComputerResourcesState } from "@rakazo/contracts";
import { ComputerResourceSettingsSchema } from "@rakazo/contracts";
import type { RunDockerResult } from "./docker-cli.js";
import { STACK_COMPOSE_FILE, STACK_ENV_FILE, STACK_PROJECT_NAME } from "./local-stack.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

const GIB = 1024 ** 3;
const ENV_LIMIT = 256 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

type DockerCommand = (args: string[], timeoutMs: number) => Promise<RunDockerResult>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Docker returned invalid resource information.");
  // The boundary above rejects null, primitives, and arrays.
  return value as Record<string, unknown>;
}

function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Docker returned invalid resource information.");
  }
}

function objects(raw: string): Record<string, unknown>[] {
  const value = json(raw);
  if (!Array.isArray(value)) throw new Error("Docker returned invalid resource information.");
  return value.map(object);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Docker returned invalid resource information.");
  return value;
}

function memoryGiB(raw: string): number {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(b|ki?b?|mi?b?|gi?b?|ti?b?)?$/i);
  if (!match) throw new Error("Memory usage could not be read.");
  const unit = (match[2] ?? "b").toLowerCase();
  const powers: Record<string, number> = { b: 0, k: 1, m: 2, g: 3, t: 4 };
  const power = powers[unit.charAt(0)];
  if (power === undefined) throw new Error("Memory usage could not be read.");
  return (Number(match[1]) * 1024 ** power) / GIB;
}

function envValue(contents: string, key: string, fallback: string): string {
  const lines = contents.split("\n").filter((line) => line.startsWith(`${key}=`));
  return (
    lines
      .at(-1)
      ?.slice(key.length + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "") || fallback
  );
}

function limit(raw: string, memory: boolean): number | null {
  if (["0", "none", "unlimited"].includes(raw.toLowerCase())) return null;
  const value = memory ? memoryGiB(raw) : Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Saved computer limits could not be read.");
  return value;
}

function replaceEnv(contents: string, key: string, value: string): string {
  const next = contents
    .split("\n")
    .filter((line) => !line.startsWith(`${key}=`))
    .join("\n")
    .replace(/\n*$/, "\n");
  return `${next}${key}=${value}\n`;
}

export class ComputerResourcesController {
  private applying = false;

  constructor(
    private readonly deps: {
      stackDir: string;
      docker: DockerCommand;
      authorized: () => boolean;
    },
  ) {}

  private async command(args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    if (!this.deps.authorized())
      throw new Error("Open the managed local instance to change computer resources.");
    const result = await this.deps.docker(args, timeoutMs);
    if (result.code !== 0)
      throw new Error("Docker could not complete the resource request. Refresh and try again.");
    return result.stdout;
  }

  private async environment(): Promise<string> {
    const contents = await readPrivateFile(
      path.join(this.deps.stackDir, STACK_ENV_FILE),
      ENV_LIMIT,
    );
    if (contents === null) throw new Error("Local computer configuration is unavailable.");
    return contents;
  }

  private async computers() {
    const ids = (await this.command(["ps", "-aq", "--filter", "label=rakazo.managed=true"]))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)) || ids.length > 256)
      throw new Error("Managed computers could not be read.");
    if (!ids.length) return [];
    return objects(await this.command(["inspect", ...ids])).filter((computer) => {
      const labels = object(object(computer.Config).Labels);
      const mounts = computer.Mounts;
      return (
        labels["rakazo.managed"] === "true" &&
        Array.isArray(mounts) &&
        mounts.some((value: unknown) => {
          const mount = object(value);
          return (
            mount.Type === "volume" &&
            mount.Name === `${STACK_PROJECT_NAME}_appdata` &&
            mount.Destination === "/home/rakazo"
          );
        })
      );
    });
  }

  async state(): Promise<ComputerResourcesState> {
    const [contents, rawInfo, computers] = await Promise.all([
      this.environment(),
      this.command(["info", "--format", "{{json .}}"]),
      this.computers(),
    ]);
    const info = object(json(rawInfo));
    const runningIds = computers
      .filter((c) => object(c.State).Running === true)
      .map((c) => String(c.Id));
    const stats = new Map<string, { memoryGiB: number; cpuCores: number }>();
    if (runningIds.length) {
      const output = await this.command([
        "stats",
        "--no-stream",
        "--no-trunc",
        "--format",
        "{{json .}}",
        ...runningIds,
      ]);
      for (const line of output.trim().split("\n").filter(Boolean)) {
        const stat = object(json(line));
        const cpu = Number.parseFloat(String(stat.CPUPerc));
        if (!Number.isFinite(cpu) || cpu < 0) throw new Error("CPU usage could not be read.");
        stats.set(String(stat.ID), {
          memoryGiB: memoryGiB(String(stat.MemUsage).split("/")[0] ?? ""),
          cpuCores: cpu / 100,
        });
      }
    }
    return {
      capacity: { memoryGiB: number(info.MemTotal) / GIB, cpuCores: number(info.NCPU) },
      defaults: {
        memoryGiB: limit(envValue(contents, "RAKAZO_COMPUTER_MEMORY", "2g"), true),
        cpuCores: limit(envValue(contents, "RAKAZO_COMPUTER_CPUS", "2"), false),
      },
      computers: computers.map((computer) => {
        const host = object(computer.HostConfig);
        const state = object(computer.State);
        const labels = object(object(computer.Config).Labels);
        const limits: ComputerResourceLimits = {
          memoryGiB: number(host.Memory) / GIB || null,
          cpuCores: number(host.NanoCpus) / 1e9 || null,
        };
        return {
          id: String(computer.Id),
          shared: String(labels["rakazo.botId"]).startsWith("team"),
          running: state.Running === true,
          limits,
          usage: stats.get(String(computer.Id)) ?? null,
          memoryKilled: state.OOMKilled === true,
        };
      }),
    };
  }

  async apply(input: unknown): Promise<ComputerResourcesState> {
    const parsed = ComputerResourceSettingsSchema.safeParse(input);
    if (!parsed.success) throw new Error("Choose valid memory and CPU limits.");
    if (this.applying) throw new Error("A resource change is already in progress.");
    this.applying = true;
    try {
      const settings = parsed.data;
      const state = await this.state();
      if (
        settings.memoryGiB > state.capacity.memoryGiB ||
        settings.cpuCores > state.capacity.cpuCores
      )
        throw new Error("Computer limits cannot exceed Docker’s available resources.");
      if (
        settings.applyToExisting &&
        state.computers.some(
          (c) => c.running && c.usage && settings.memoryGiB < c.usage.memoryGiB + 0.25,
        )
      )
        throw new Error("Memory is in use. Stop the computer before lowering its limit.");
      const contents = await this.environment();
      const next = replaceEnv(
        replaceEnv(contents, "RAKAZO_COMPUTER_MEMORY", `${settings.memoryGiB}g`),
        "RAKAZO_COMPUTER_CPUS",
        String(settings.cpuCores),
      );
      if (!this.deps.authorized())
        throw new Error("The local instance changed. Open settings again.");
      await writePrivateFile(path.join(this.deps.stackDir, STACK_ENV_FILE), next);
      if (
        state.defaults.memoryGiB !== settings.memoryGiB ||
        state.defaults.cpuCores !== settings.cpuCores
      ) {
        try {
          await this.command(
            [
              "compose",
              "--env-file",
              STACK_ENV_FILE,
              "-f",
              STACK_COMPOSE_FILE,
              "--project-name",
              STACK_PROJECT_NAME,
              "up",
              "-d",
              "--no-deps",
              "--pull",
              "never",
              "--wait",
              "--wait-timeout",
              "90",
              "supervisor",
            ],
            120_000,
          );
        } catch (error) {
          // Restore only our own write; another setup operation may have changed the file.
          if (this.deps.authorized() && (await this.environment()) === next) {
            await writePrivateFile(path.join(this.deps.stackDir, STACK_ENV_FILE), contents);
          }
          throw error;
        }
      }
      if (settings.applyToExisting) {
        // Re-read ownership after changing the supervisor; never accept renderer-supplied container IDs.
        const current = await this.computers();
        for (const computer of current) {
          await this.command([
            "update",
            "--memory",
            String(settings.memoryGiB * GIB),
            "--memory-swap",
            String(settings.memoryGiB * GIB),
            "--cpus",
            String(settings.cpuCores),
            String(computer.Id),
          ]);
        }
      }
      return await this.state();
    } finally {
      this.applying = false;
    }
  }
}
