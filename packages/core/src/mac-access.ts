import { mcpServerLocation } from "./mcp-input.js";

/**
 * Mac access is an ordinary MCP server the desktop app hosts on the user's Mac. Its endpoint path
 * only identifies it for display and selection; authorization stays with the server's own token.
 */
export const MAC_COMPUTER_MCP_NAME = "Mac computer";

export type McpAssignmentInput = {
  serverId: string;
  allowAllTools: boolean;
  allowedTools: string[];
};

export function isMacComputerServer(server: { transport: string; endpoint: string | null }) {
  const location = mcpServerLocation(server);
  return location.kind === "mac" && location.host === "computer";
}

export function macComputerServers<Server extends { transport: string; endpoint: string | null }>(
  servers: readonly Server[],
): Server[] {
  return servers.filter(isMacComputerServer);
}

/** Adds one Mac server to a bot's assignments and keeps every other assignment as it was. */
export function grantMacAccess(
  assignments: readonly McpAssignmentInput[],
  serverId: string,
): McpAssignmentInput[] {
  const kept = assignments.map(assignmentInput);
  if (kept.some((assignment) => assignment.serverId === serverId)) return kept;
  return [...kept, { serverId, allowAllTools: true, allowedTools: [] }];
}

/** Removes only the bot's Mac assignments; the Mac's own approval is left alone. */
export function revokeMacAccess(
  assignments: readonly McpAssignmentInput[],
  macServerIds: readonly string[],
): McpAssignmentInput[] {
  return assignments
    .filter((assignment) => !macServerIds.includes(assignment.serverId))
    .map(assignmentInput);
}

function assignmentInput(assignment: McpAssignmentInput): McpAssignmentInput {
  return {
    serverId: assignment.serverId,
    allowAllTools: assignment.allowAllTools,
    allowedTools: [...assignment.allowedTools],
  };
}
