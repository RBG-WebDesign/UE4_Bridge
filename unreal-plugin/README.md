# Unreal Plugin - MCP Bridge Listener

Python scripts that run inside UE4.27's editor to receive and execute commands from the MCP server.

## Installation

1. Copy the `Content/Python/` folder contents into your UE4 project's `Content/Python/` folder
2. Enable "Python Editor Script Plugin" in Edit > Plugins
3. Add the config from `Config/DefaultEngine.ini.example` to your project's `DefaultEngine.ini`
4. Restart the editor

## Folder Structure
```
Content/Python/
  startup.py                 # Auto-starts the listener on editor open
  mcp_bridge/
    __init__.py
    listener.py              # HTTP server on localhost:8080
    router.py                # Command dispatch table
    handlers/                # Command handler implementations
      system.py              # ping, python_proxy, logs
      project.py             # project_info, asset_list, asset_info
      actors.py              # spawn, modify, delete, duplicate, etc.
      level.py               # level_actors, level_save, level_outliner
      viewport.py            # screenshot, camera, focus, etc.
      materials.py           # material_list, create, apply
      blueprints.py          # blueprint_create, compile, etc.
    utils/
      serialization.py       # UE4 objects to JSON
      transactions.py        # Undo transaction wrappers
      validation.py          # Transform validation helpers
```

## Manual Start
If the auto-start does not work, open UE4's Python console and run:
```python
from mcp_bridge.listener import start
start()
```

## Verify
```
curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d "{\"command\":\"ping\"}"
```
