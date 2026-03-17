/**
 * Blueprint tools: blueprint_list, blueprint_info, blueprint_create, blueprint_compile, blueprint_document.
 */
import { z } from "zod";
export function createBlueprintTools(client) {
    return [
        {
            name: "blueprint_list",
            description: "List Blueprint assets with optional filtering by path, name, and parent class.",
            inputSchema: z.object({
                path_filter: z
                    .string()
                    .optional()
                    .describe("Content path prefix (default /Game/)"),
                name_filter: z
                    .string()
                    .optional()
                    .describe("Filter by name (supports fnmatch wildcards)"),
                parent_class_filter: z
                    .string()
                    .optional()
                    .describe("Filter by parent class name (e.g., Actor, Pawn, Character)"),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(2000)
                    .default(200)
                    .describe("Max results to return"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("blueprint_list", params);
                return {
                    content: [
                        { type: "text", text: JSON.stringify(result, null, 2) },
                    ],
                };
            },
        },
        {
            name: "blueprint_info",
            description: "Get detailed Blueprint structure: components, variables, functions, event graphs, parent chain.",
            inputSchema: z.object({
                blueprint_path: z
                    .string()
                    .startsWith("/")
                    .describe("Asset path of the Blueprint"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("blueprint_info", params);
                return {
                    content: [
                        { type: "text", text: JSON.stringify(result, null, 2) },
                    ],
                };
            },
        },
        {
            name: "blueprint_create",
            description: "Create a new Blueprint class with optional components and variables.",
            inputSchema: z.object({
                name: z.string().min(1).describe("Blueprint name"),
                path: z
                    .string()
                    .startsWith("/")
                    .default("/Game/Blueprints")
                    .describe("Content directory to create in"),
                parent_class: z
                    .string()
                    .min(1)
                    .default("Actor")
                    .describe("Parent class name (Actor, Pawn, Character, PlayerController, GameModeBase, ActorComponent, SceneComponent)"),
                components: z
                    .array(z.object({
                    name: z.string().min(1).describe("Component name"),
                    class: z
                        .string()
                        .min(1)
                        .describe("Component class (e.g., BoxComponent, StaticMeshComponent)"),
                    attach_to: z
                        .string()
                        .optional()
                        .describe("Parent component to attach to"),
                }))
                    .optional()
                    .describe("Components to add to the Blueprint"),
                variables: z
                    .array(z.object({
                    name: z.string().min(1).describe("Variable name"),
                    type: z
                        .string()
                        .min(1)
                        .describe("Variable type (Boolean, Integer, Float, String, Vector, Rotator, Transform, Actor)"),
                    default_value: z.any().optional().describe("Default value"),
                    category: z.string().optional().describe("Variable category for grouping"),
                    editable: z
                        .boolean()
                        .default(true)
                        .describe("Whether editable in details panel"),
                    tooltip: z.string().optional().describe("Tooltip text"),
                }))
                    .optional()
                    .describe("Variables to add (may be skipped in 4.27 if API is limited)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("blueprint_create", params);
                return {
                    content: [
                        { type: "text", text: JSON.stringify(result, null, 2) },
                    ],
                };
            },
        },
        {
            name: "blueprint_compile",
            description: "Compile a Blueprint and return success/failure with error details. Success means the compile ran, check 'compiled' and 'had_errors' for actual result.",
            inputSchema: z.object({
                blueprint_path: z
                    .string()
                    .startsWith("/")
                    .describe("Asset path of the Blueprint to compile"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("blueprint_compile", params);
                return {
                    content: [
                        { type: "text", text: JSON.stringify(result, null, 2) },
                    ],
                };
            },
        },
        {
            name: "blueprint_document",
            description: "Generate a human-readable text summary of a Blueprint's structure, variables, and components.",
            inputSchema: z.object({
                blueprint_path: z
                    .string()
                    .startsWith("/")
                    .describe("Asset path of the Blueprint"),
                detail_level: z
                    .enum(["minimal", "standard", "detailed"])
                    .default("standard")
                    .describe("Level of detail: minimal, standard, or detailed"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("blueprint_document", params);
                return {
                    content: [
                        { type: "text", text: JSON.stringify(result, null, 2) },
                    ],
                };
            },
        },
        {
            name: "blueprint_build_from_json",
            description: "Builds a Blueprint event graph from a JSON node/connection description. " +
                "Supported node types: BeginPlay, PrintString, Delay, CallFunction. " +
                "Connections use 'nodeId.exec' format for exec pin wiring.",
            inputSchema: z.object({
                blueprint_path: z
                    .string()
                    .startsWith("/")
                    .describe("Content path of the Blueprint, e.g. /Game/BP_TestGraph.BP_TestGraph"),
                graph: z.object({
                    nodes: z.array(z.object({
                        id: z.string().describe("Unique node identifier"),
                        type: z.string().describe("Node type: BeginPlay | PrintString | Delay | CallFunction"),
                        function: z.string().optional().describe("Required when type is CallFunction -- function name on UKismetSystemLibrary"),
                    })),
                    connections: z.array(z.object({
                        from: z.string().describe("Source node and pin role: nodeId.exec"),
                        to: z.string().describe("Target node and pin role: nodeId.exec"),
                    })),
                }),
                clear_existing: z.boolean().default(true).describe("Clear existing graph before building"),
            }),
            handler: async (params) => {
                const { blueprint_path, graph, clear_existing } = params;
                // Escape for safe embedding in Python single-quoted strings
                const escapedPath = blueprint_path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                const graphJson = JSON.stringify(graph)
                    .replace(/\\/g, "\\\\")
                    .replace(/'/g, "\\'");
                const clearFlag = (clear_existing ?? true) ? "True" : "False";
                const code = `\
import unreal
bp = unreal.load_object(None, '${escapedPath}')
if not bp:
    raise Exception('Blueprint not found at path: ${escapedPath}')
unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, '${graphJson}', ${clearFlag})
print('blueprint_build_from_json: done')
`;
                // Note: graphJson is already a valid JSON string -- pass it directly to C++.
                // The C++ function calls FJsonSerializer::Deserialize internally, so no Python
                // json.loads/json.dumps roundtrip is needed.
                const result = await client.sendCommand("python_proxy", { code });
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            },
        },
    ];
}
//# sourceMappingURL=blueprints.js.map