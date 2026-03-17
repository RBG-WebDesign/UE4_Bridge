/**
 * Operations tools: undo, redo, history, checkpoints, batch.
 * These run entirely in the MCP server layer (with undo/redo calling UE4).
 */
import { z } from "zod";
export function createOperationsTools(client, history) {
    return [
        {
            name: "undo",
            description: "Undo the last N operations using UE4's transaction system.",
            inputSchema: z.object({
                count: z.number().optional().describe("Number of operations to undo (default 1)"),
            }),
            handler: async (params) => {
                const count = params.count || 1;
                const result = await client.sendCommand("undo", { count });
                if (result.success) {
                    history.markUndone(count);
                }
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "redo",
            description: "Redo previously undone operations.",
            inputSchema: z.object({
                count: z.number().optional().describe("Number of operations to redo (default 1)"),
            }),
            handler: async (params) => {
                const count = params.count || 1;
                const result = await client.sendCommand("redo", { count });
                if (result.success) {
                    history.markRedone(count);
                }
                return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
            },
        },
        {
            name: "history_list",
            description: "Show operation history with timestamps and parameters.",
            inputSchema: z.object({
                count: z.number().optional().describe("Number of recent entries to show"),
            }),
            handler: async (params) => {
                const count = params.count;
                const entries = history.getHistory(count);
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                data: { count: entries.length, entries },
                            }, null, 2) }],
                };
            },
        },
        {
            name: "checkpoint_create",
            description: "Create a named save point (level save + metadata snapshot).",
            inputSchema: z.object({
                name: z.string().describe("Checkpoint name"),
                description: z.string().optional().describe("Checkpoint description"),
            }),
            handler: async (params) => {
                // Save the level first
                await client.sendCommand("level_save", { save_all: true });
                const checkpoint = history.createCheckpoint(params.name, params.description || "");
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                data: checkpoint,
                            }, null, 2) }],
                };
            },
        },
        {
            name: "checkpoint_restore",
            description: "Restore to a named checkpoint by undoing operations since it was created.",
            inputSchema: z.object({
                name: z.string().describe("Checkpoint name to restore"),
            }),
            handler: async (params) => {
                const name = params.name;
                const checkpoint = history.getCheckpoint(name);
                if (!checkpoint) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                                    success: false,
                                    error: `Checkpoint not found: ${name}`,
                                }, null, 2) }],
                    };
                }
                const opsToUndo = history.operationsSinceCheckpoint(name);
                if (opsToUndo > 0) {
                    await client.sendCommand("undo", { count: opsToUndo });
                    history.markUndone(opsToUndo);
                }
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                data: { checkpoint: name, operations_undone: opsToUndo },
                            }, null, 2) }],
                };
            },
        },
        {
            name: "batch_operations",
            description: "Execute multiple tool calls in a single request with shared validation.",
            inputSchema: z.object({
                operations: z.array(z.object({
                    command: z.string().describe("Command name"),
                    params: z.record(z.unknown()).optional().describe("Command parameters"),
                })).describe("Array of operations to execute"),
            }),
            handler: async (params) => {
                const operations = params.operations;
                const results = [];
                // Wrap all operations in a single transaction
                await client.sendCommand("begin_transaction", { description: "Batch operation" });
                for (const op of operations) {
                    const result = await client.sendCommand(op.command, op.params || {});
                    results.push({
                        command: op.command,
                        success: result.success,
                        data: result.data,
                        error: result.error,
                    });
                    if (result.success) {
                        history.record(op.command, op.params || {}, `Batch: ${op.command}`);
                    }
                }
                await client.sendCommand("end_transaction", {});
                const successCount = results.filter((r) => r.success).length;
                return {
                    content: [{ type: "text", text: JSON.stringify({
                                success: true,
                                data: {
                                    total: operations.length,
                                    succeeded: successCount,
                                    failed: operations.length - successCount,
                                    results,
                                },
                            }, null, 2) }],
                };
            },
        },
    ];
}
//# sourceMappingURL=operations.js.map