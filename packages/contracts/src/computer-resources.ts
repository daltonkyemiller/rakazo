import { z } from "zod";

export const ComputerResourceSettingsSchema = z.object({
  memoryGiB: z.number().min(0.5).max(1024).multipleOf(0.25),
  cpuCores: z.number().min(0.5).max(256).multipleOf(0.5),
  applyToExisting: z.boolean(),
});

export type ComputerResourceSettings = z.infer<typeof ComputerResourceSettingsSchema>;
export type ComputerResourceLimits = {
  memoryGiB: number | null;
  cpuCores: number | null;
};

export interface ComputerResourcesState {
  capacity: { memoryGiB: number; cpuCores: number };
  defaults: ComputerResourceLimits;
  computers: Array<{
    id: string;
    shared: boolean;
    running: boolean;
    limits: ComputerResourceLimits;
    usage: { memoryGiB: number; cpuCores: number } | null;
    memoryKilled: boolean;
  }>;
}
