"""Editor startup script that launches the MCP Bridge listener.

This file should be placed at: YourProject/Content/Python/startup.py
Configure it in DefaultEngine.ini as a startup script for the Python plugin.
"""

import unreal


def _start_mcp_bridge():
    """Start the MCP Bridge listener after a short delay."""
    try:
        from mcp_bridge.listener import start, is_running
        
        if is_running():
            unreal.log("[MCP Bridge] Listener already running, skipping startup")
            return
        
        success = start()
        if success:
            unreal.log("[MCP Bridge] Listener started successfully on localhost:8080")
        else:
            unreal.log_error("[MCP Bridge] Failed to start listener")
    except Exception as e:
        unreal.log_error(f"[MCP Bridge] Startup error: {str(e)}")


# Start the bridge when this script is loaded
unreal.log("[MCP Bridge] Startup script loaded, initializing...")
_start_mcp_bridge()
