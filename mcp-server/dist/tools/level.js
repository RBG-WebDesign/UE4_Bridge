/**
 * Level tools: level_actors, level_save, level_outliner.
 */
import { z } from "zod";
export function createLevelTools(client) {
    return [
        {
            name: "level_actors",
            description: "List actors in the current level with optional filters. Returns name, class, folder, and optionally transforms and components.",
            inputSchema: z.object({
                class_filter: z.string().optional().describe("Filter by class name (supports * and ? wildcards)"),
                folder_filter: z.string().optional().describe("Filter by World Outliner folder prefix"),
                name_filter: z.string().optional().describe("Filter by actor label (supports * and ? wildcards)"),
                include_transforms: z.boolean().optional().describe("Include location/rotation/scale (default true)"),
                include_components: z.boolean().optional().describe("Include component list (default false)"),
                limit: z.number().int().min(1).optional().describe("Max actors to return (default 500)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("level_actors", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "level_save",
            description: "Save the current level and optionally all dirty assets.",
            inputSchema: z.object({
                save_all: z.boolean().optional().describe("Also save all modified assets (default false)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("level_save", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "level_outliner",
            description: "Return the World Outliner folder tree structure with actor counts per folder.",
            inputSchema: z.object({
                root_folder: z.string().optional().describe("Optional subtree root to start from"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("level_outliner", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
    ];
}
//# sourceMappingURL=level.js.map