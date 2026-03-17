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

export class OperationHistory {
  private entries: HistoryEntry[] = [];
  private checkpoints: Map<string, Checkpoint> = new Map();
  private nextId: number = 1;

  /**
   * Record an operation in the history.
   */
  record(command: string, params: Record<string, unknown>, description: string): number {
    const entry: HistoryEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      command,
      params,
      description,
      undone: false,
    };
    this.entries.push(entry);
    return entry.id;
  }

  /**
   * Get recent history entries.
   */
  getHistory(count?: number): HistoryEntry[] {
    const activeEntries = this.entries.filter((e) => !e.undone);
    if (count) {
      return activeEntries.slice(-count);
    }
    return activeEntries;
  }

  /**
   * Mark the last N operations as undone.
   */
  markUndone(count: number = 1): HistoryEntry[] {
    const undone: HistoryEntry[] = [];
    const activeEntries = this.entries.filter((e) => !e.undone);
    const toUndo = activeEntries.slice(-count);

    for (const entry of toUndo) {
      entry.undone = true;
      undone.push(entry);
    }
    return undone;
  }

  /**
   * Mark the last N undone operations as redone.
   */
  markRedone(count: number = 1): HistoryEntry[] {
    const redone: HistoryEntry[] = [];
    const undoneEntries = this.entries.filter((e) => e.undone).slice(-count);

    for (const entry of undoneEntries) {
      entry.undone = false;
      redone.push(entry);
    }
    return redone;
  }

  /**
   * Create a named checkpoint.
   */
  createCheckpoint(name: string, description: string = ""): Checkpoint {
    const checkpoint: Checkpoint = {
      name,
      timestamp: new Date().toISOString(),
      historyIndex: this.entries.length,
      description,
    };
    this.checkpoints.set(name, checkpoint);
    return checkpoint;
  }

  /**
   * Get a checkpoint by name.
   */
  getCheckpoint(name: string): Checkpoint | undefined {
    return this.checkpoints.get(name);
  }

  /**
   * List all checkpoints.
   */
  listCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Get the number of operations since a checkpoint.
   */
  operationsSinceCheckpoint(name: string): number {
    const checkpoint = this.checkpoints.get(name);
    if (!checkpoint) return -1;
    return this.entries.length - checkpoint.historyIndex;
  }
}
