import type { McpServer } from "@rakazo/contracts";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { McpServerAdd } from "../../components/mcp-server-add";
import { rpc } from "../../lib/api";

/** Adding an MCP server is its own page in the settings stack, so Back always leaves it. */
export default function McpServerAddScreen() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const load = useCallback(() => {
    void rpc<McpServer[]>("mcp/servers/list")
      .then(setServers)
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <McpServerAdd servers={servers} onAdded={load} onDone={() => router.back()} />
    </ScrollView>
  );
}
