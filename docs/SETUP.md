# Setup Guide

## Prerequisites
- Unreal Engine 4.27 (Epic Games Launcher install)
- Node.js 18 or later
- npm 9 or later
- A UE4 project with the Python Editor Script Plugin enabled

## Step 1: Enable Python in UE4
1. Open your UE4 project in the editor
2. Go to Edit > Plugins
3. Search for "Python Editor Script Plugin"
4. Enable it and restart the editor

## Step 2: Install the Python Listener
Copy the contents of `unreal-plugin/Content/Python/` into your UE4 project's `Content/Python/` folder.

Your project folder should look like:
```
YourProject/
  Content/
    Python/
      startup.py
      mcp_bridge/
        __init__.py
        listener.py
        router.py
        handlers/
        utils/
```

## Step 3: Configure Editor Startup
Add to your project's `DefaultEngine.ini` under `[/Script/PythonScriptPlugin.PythonScriptPluginSettings]`:
```ini
bDeveloperMode=True
bRemoteExecution=True
StartupScripts=/Game/Python/startup.py
```

Or see `unreal-plugin/Config/DefaultEngine.ini.example` for the full config block.

## Step 4: Build the MCP Server
```
cd unreal-mcp-bridge
npm install
npm run build
```

## Step 5: Test the Connection
1. Restart the UE4 editor (the Python listener starts automatically)
2. Verify the listener is running:
   ```
   curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d "{\"command\":\"ping\"}"
   ```
3. Open Claude Code in the `unreal-mcp-bridge` directory
4. Ask Claude to "test connection to Unreal Engine"

## Step 6: Verify
Claude should be able to execute Python inside Unreal. Try asking:
"Run `unreal.SystemLibrary.get_game_name()` in Unreal"
