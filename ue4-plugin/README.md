# BlueprintGraphBuilder Plugin

A UE4.27 Editor plugin that builds Blueprint event graphs from JSON descriptions.
Called from Python via UE4's Python bindings, and exposed through the MCP tool `blueprint_build_from_json`.

## What it does

Takes a JSON node/connection description and writes it directly into a Blueprint's event graph.
Clears the existing graph, spawns the specified nodes, and wires exec pins between them.

Supported node types (Pass 1): `BeginPlay`, `PrintString`

## Install

1. Copy the `BlueprintGraphBuilder/` folder into your UE4 project's `Plugins/` directory:

```
YourProject/
└── Plugins/
    └── BlueprintGraphBuilder/   <-- copy here
        ├── BlueprintGraphBuilder.uplugin
        └── Source/
```

2. Open your project in UE4.27. When prompted to rebuild the plugin, click **Yes**.

3. After the editor loads, verify the plugin compiled:
   - Go to **Edit > Plugins**
   - Search for `Blueprint Graph Builder`
   - Confirm it shows as enabled

4. Verify Python bindings loaded. Open the Output Log and run:

```python
import unreal
print(dir(unreal.BlueprintGraphBuilderLibrary))
```

You should see `build_blueprint_from_json` in the output.

## Usage from Python

```python
import unreal, json

bp = unreal.load_object(None, "/Game/MyBlueprint.MyBlueprint")

graph_data = {
    "nodes": [
        {"id": "start", "type": "BeginPlay"},
        {"id": "print", "type": "PrintString"}
    ],
    "connections": [
        {"from": "start.exec", "to": "print.exec"}
    ]
}

unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(
    bp,
    json.dumps(graph_data),
    True  # clear existing graph
)
```

## Usage via MCP tool

With the MCP server running, call `blueprint_build_from_json`:

```json
{
  "blueprint_path": "/Game/MyBlueprint.MyBlueprint",
  "graph": {
    "nodes": [
      { "id": "start", "type": "BeginPlay" },
      { "id": "print", "type": "PrintString" }
    ],
    "connections": [
      { "from": "start.exec", "to": "print.exec" }
    ]
  },
  "clear_existing": true
}
```

## Requirements

- UE4.27
- Python Editor Script Plugin enabled in your project
- The MCP Bridge Python listener running (for MCP tool usage)

## Troubleshooting

**"Would you like to rebuild?" prompt never appears**
The plugin folder may be in the wrong location. It must be under `YourProject/Plugins/`, not the engine plugins folder.

**`AttributeError: type object 'BlueprintGraphBuilderLibrary' has no attribute 'build_blueprint_from_json'`**
The plugin is not enabled or did not compile. Check Edit > Plugins and look for build errors in the Output Log.

**Blueprint graph is empty after the call**
JSON parse failed. Check the Output Log for `BuildBlueprintFromJSON: Invalid JSON`.

**Nodes present but not connected**
Exec pin lookup failed. Check the Output Log for `Could not find exec pins`.
