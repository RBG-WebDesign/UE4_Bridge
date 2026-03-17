/**
 * Operation history tracking for undo/redo/checkpoints.
 *
 * This manages a history layer on top of UE4's native transaction system.
 * The MCP server tracks what operations were performed so it can provide
 * named undo, operation history, and checkpoint/restore functionality.
 */
export interface HistoryEntry {
    id: number;
    timestamp: string;
    command: string;
    params: Record<string, unknown>;
    description: string;
    undone: boolean;
}
export interface Checkpoint {
    name: string;
    timestamp: string;
    historyIndex: number;
    description: string;
}
export declare class OperationHistory {
    private entries;
    private checkpoints;
    private nextId;
    /**
     * Record an operation in the history.
     */
    record(command: string, params: Record<string, unknown>, description: string): number;
    /**
     * Get recent history entries.
     */
    getHistory(count?: number): HistoryEntry[];
    /**
     * Mark the last N operations as undone.
     */
    markUndone(count?: number): HistoryEntry[];
    /**
     * Mark the last N undone operations as redone.
     */
    markRedone(count?: number): HistoryEntry[];
    /**
     * Create a named checkpoint.
     */
    createCheckpoint(name: string, description?: string): Checkpoint;
    /**
     * Get a checkpoint by name.
     */
    getCheckpoint(name: string): Checkpoint | undefined;
    /**
     * List all checkpoints.
     */
    listCheckpoints(): Checkpoint[];
    /**
     * Get the number of operations since a checkpoint.
     */
    operationsSinceCheckpoint(name: string): number;
}
//# sourceMappingURL=history.d.ts.map