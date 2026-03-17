/**
 * HTTP client for communicating with the UE4 Python listener.
 *
 * Sends JSON commands to localhost:8080 and returns parsed responses.
 * This module is the only point of contact between the MCP server and Unreal.
 */
export interface UnrealResponse {
    success: boolean;
    data: Record<string, unknown>;
    error?: string;
}
export interface UnrealClientOptions {
    host: string;
    port: number;
    timeout: number;
}
export declare class UnrealClient {
    private options;
    constructor(options?: Partial<UnrealClientOptions>);
    /**
     * Send a command to the UE4 Python listener.
     */
    sendCommand(command: string, params?: Record<string, unknown>): Promise<UnrealResponse>;
    /**
     * Quick connection check.
     */
    ping(): Promise<boolean>;
}
//# sourceMappingURL=unreal-client.d.ts.map