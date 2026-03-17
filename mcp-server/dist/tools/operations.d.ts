/**
 * Operations tools: undo, redo, history, checkpoints, batch.
 * These run entirely in the MCP server layer (with undo/redo calling UE4).
 */
import { UnrealClient } from "../unreal-client.js";
import { OperationHistory } from "../history.js";
import type { ToolDefinition } from "../types.js";
export declare function createOperationsTools(client: UnrealClient, history: OperationHistory): ToolDefinition[];
//# sourceMappingURL=operations.d.ts.map