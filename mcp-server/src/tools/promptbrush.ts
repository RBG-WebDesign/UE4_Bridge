/**
 * PromptBrush tools: prompt_generate, prompt_status, prompt_spec_list,
 * blueprint_build_from_json, widget_build_from_json.
 */

import { z } from "zod";
import { UnrealClient } from "../unreal-client.js";
import type { ToolDefinition } from "../types.js";

export function createPromptBrushTools(client: UnrealClient): ToolDefinition[] {
  return [
    {
      name: "prompt_generate",
      description:
        "Generate complete Unreal Engine 4.27 gameplay systems from a natural language prompt. " +
        "Creates Blueprints, Widget Blueprints, materials, data assets, maps, actors, and input " +
        "mappings. Supports genres: puzzle_fighter, menu_system, horror, platformer, inventory, generic. " +
        "Use dry_run=true to preview the build spec without creating any assets.",
      inputSchema: z.object({
        prompt: z.string().describe(
          "Natural language description of what to build. " +
          "Examples: 'Make me gameplay like Puzzle Fighter', " +
          "'Create a main menu HUD and pause screen', " +
          "'Build a horror hallway trigger sequence'"
        ),
        dry_run: z
          .boolean()
          .optional()
          .describe("If true, return the build spec JSON without creating any assets in UE4"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("prompt_generate", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    },
    {
      name: "prompt_status",
      description:
        "Check PromptBrush system status: BlueprintGraphBuilder availability, " +
        "WidgetBlueprintBuilder availability, output directory path, and manifest count.",
      inputSchema: z.object({}),
      handler: async (_params) => {
        const result = await client.sendCommand("prompt_status", {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    },
    {
      name: "prompt_spec_list",
      description:
        "List previously generated build specs from the PromptBrush output directory. " +
        "Each entry shows feature name, genre, and the original prompt.",
      inputSchema: z.object({}),
      handler: async (_params) => {
        const result = await client.sendCommand("prompt_spec_list", {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    },
    {
      name: "blueprint_build_from_json",
      description:
        "Build a Blueprint event graph from a JSON schema using BlueprintGraphBuilderLibrary. " +
        "The Blueprint must already exist. This populates its event graph nodes and wiring.",
      inputSchema: z.object({
        blueprint_path: z
          .string()
          .startsWith("/")
          .describe("Asset path of the Blueprint to populate e.g. /Game/Blueprints/BP_MyActor"),
        graph_json: z
          .record(z.unknown())
          .describe("Graph specification object matching BlueprintGraphBuilderLibrary schema"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("blueprint_build_from_json", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    },
    {
      name: "widget_build_from_json",
      description:
        "Create a Widget Blueprint from a JSON widget tree using WidgetBlueprintBuilderLibrary. " +
        "Creates the asset at package_path/asset_name and populates the designer tree.",
      inputSchema: z.object({
        package_path: z
          .string()
          .startsWith("/")
          .describe("Content directory path e.g. /Game/UI/Widgets"),
        asset_name: z
          .string()
          .describe("Widget Blueprint asset name e.g. WBP_MyWidget"),
        widget_json: z
          .record(z.unknown())
          .describe("Widget tree object with type, name, properties, slot, and children fields"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("widget_build_from_json", params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    },
  ];
}
