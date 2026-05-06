# MCP Bridge Installer

Use `Scripts/install-mcp-bridge.ps1` to install or update the MCP Bridge in any UE4.27 project.

The installer keeps one shared bridge checkout as the source of truth, then updates the target project with the files Unreal needs locally.

## What It Installs

Into the target Unreal project:

```text
Content/Python/startup.py
Content/Python/mcp_bridge/
Plugins/BlueprintGraphBuilder/
.mcp.json
Config/DefaultEngine.ini Python startup settings
```

The MCP server stays in this bridge repository. The generated `.mcp.json` points back to the shared `mcp-server/dist/index.js` with an absolute path, so updating the shared bridge updates the MCP server for every installed project.

## Install

From this repository root:

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject"
```

You can also pass the project directory:

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame"
```

The script runs `npm install` if `node_modules` is missing, then runs `npm run build`.

## Update Later

Pull or copy the latest bridge source, then rerun the same command:

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject"
```

For a cleaner update of managed bridge folders:

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject" -CleanManaged
```

`-CleanManaged` replaces the managed Python listener folder and BlueprintGraphBuilder plugin folder before copying fresh files. It does not delete unrelated project folders.

## Useful Options

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject" -SkipBuild
```

Use `-SkipBuild` if the MCP server was already built.

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject" -SkipCppPlugin
```

Use `-SkipCppPlugin` if the project does not need Blueprint graph generation.

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject" -IncludeUnrealApi
```

Use `-IncludeUnrealApi` to add the optional `unreal-api` MCP server entry.

```powershell
.\Scripts\install-mcp-bridge.ps1 "D:\Unreal Projects\MyGame\MyGame.uproject" -WhatIf
```

Use `-WhatIf` to preview file changes.

## After Install

1. Open the project in UE4.27.
2. Enable `Python Editor Script Plugin` if it is not already enabled.
3. Restart the editor.
4. Accept the rebuild prompt if BlueprintGraphBuilder was installed.
5. Test the listener:

```powershell
curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d "{\"command\":\"ping\"}"
```

Then open Claude Code in the project folder and ask:

```text
Test the Unreal connection.
```
