/**
 * Project and asset tools: project_info, asset_list, asset_info.
 */

import { z } from "zod";
import { UnrealClient } from "../unreal-client.js";
import type { ToolDefinition } from "../types.js";

export function createProjectTools(client: UnrealClient): ToolDefinition[] {
  return [
    {
      name: "project_info",
      description: "Return current UE project name, engine version, project path, content directory, and loaded level.",
      inputSchema: z.object({}),
      handler: async () => {
        const result = await client.sendCommand("project_info");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "asset_list",
      description: "List assets with optional filters. Returns asset paths, types, and names.",
      inputSchema: z.object({
        path: z.string().optional().describe("Path prefix to search under (default: /Game/)"),
        asset_type: z.string().optional().describe("Filter by asset type class name"),
        name_pattern: z.string().optional().describe("Filter by name substring"),
        recursive: z.boolean().optional().describe("Search recursively (default: true)"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("asset_list", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "asset_info",
      description: "Return detailed info for a single asset: type, bounds, material slots, LOD count.",
      inputSchema: z.object({
        path: z.string().describe("Asset path (e.g., /Game/Meshes/SM_Cube)"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("asset_info", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
