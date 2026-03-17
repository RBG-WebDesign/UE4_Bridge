/**
 * Shared type definitions for the MCP server.
 */
import { z } from "zod";
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodType;
    handler: (params: Record<string, unknown>) => Promise<{
        content: Array<{
            type: "text";
            text: string;
        }>;
    }>;
}
//# sourceMappingURL=types.d.ts.map