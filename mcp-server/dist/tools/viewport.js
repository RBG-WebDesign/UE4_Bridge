/**
 * Viewport tools: screenshot, camera, mode, focus, render_mode, bounds, fit, look_at.
 */
import { z } from "zod";
export function createViewportTools(client) {
    return [
        {
            name: "viewport_screenshot",
            description: "Capture the active viewport to a PNG file. Returns the absolute filesystem path so Claude Code can read the image.",
            inputSchema: z.object({
                filename: z.string().optional().describe("Output filename (auto-generated if omitted)"),
                resolution: z.object({
                    width: z.number().int().min(1).optional().describe("Width in pixels (default 1920)"),
                    height: z.number().int().min(1).optional().describe("Height in pixels (default 1080)"),
                }).optional().describe("Screenshot resolution"),
                show_ui: z.boolean().optional().describe("Include editor UI in capture (default false)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_screenshot", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_camera",
            description: "Set viewport camera position, rotation, and/or FOV. Preserves existing values for parameters not provided.",
            inputSchema: z.object({
                location: z.array(z.number()).length(3).optional().describe("Camera position [x, y, z]"),
                rotation: z.array(z.number()).length(3).optional().describe("Camera rotation [pitch, yaw, roll]"),
                fov: z.number().min(1).max(170).optional().describe("Field of view in degrees"),
            }).refine((data) => data.location !== undefined || data.rotation !== undefined || data.fov !== undefined, { message: "Provide at least one of: location, rotation, fov" }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_camera", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_mode",
            description: "Switch to a standard view: top, front, right, left, back, bottom, perspective.",
            inputSchema: z.object({
                mode: z.enum(["perspective", "top", "bottom", "front", "back", "left", "right"]).describe("View mode"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_mode", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_focus",
            description: "Focus the viewport camera on a named actor. Returns camera state and actor bounding box.",
            inputSchema: z.object({
                actor_name: z.string().describe("Label of actor to focus on"),
                distance: z.number().positive().optional().describe("Distance from actor (default 500)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_focus", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_render_mode",
            description: "Change viewport render mode: lit, unlit, wireframe, detail_lighting, lighting_only, light_complexity, shader_complexity, collision.",
            inputSchema: z.object({
                mode: z.enum(["lit", "unlit", "wireframe", "detail_lighting", "lighting_only", "light_complexity", "shader_complexity", "collision"]).describe("Render mode"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_render_mode", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_bounds",
            description: "Return current viewport camera position, rotation, and state. Read-only query.",
            inputSchema: z.object({}),
            handler: async () => {
                const result = await client.sendCommand("viewport_bounds");
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_fit",
            description: "Fit actors into the viewport frame. If actor_names is empty or omitted, fits all actors in the level.",
            inputSchema: z.object({
                actor_names: z.array(z.string()).optional().describe("Actor labels to fit (empty = fit all)"),
                padding: z.number().positive().optional().describe("Distance multiplier (default 1.2 = 20% extra)"),
            }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_fit", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "viewport_look_at",
            description: "Point camera at coordinates or actor without moving camera position. If both are provided, actor_name takes priority.",
            inputSchema: z.object({
                actor_name: z.string().optional().describe("Actor label to look at"),
                location: z.array(z.number()).length(3).optional().describe("World coordinates [x, y, z] to look at"),
            }).refine((data) => data.actor_name !== undefined || data.location !== undefined, { message: "Provide at least one of: actor_name, location" }),
            handler: async (params) => {
                const result = await client.sendCommand("viewport_look_at", params);
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
    ];
}
//# sourceMappingURL=viewport.js.map