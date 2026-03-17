# Blueprint Graph Builder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a UE4.27 C++ Editor plugin that constructs Blueprint event graphs from JSON, callable from Python and exposed via a new MCP tool `blueprint_build_from_json`.

**Architecture:** Project-level plugin (`CodePlayground/Plugins/BlueprintGraphBuilder/`) with a single `UBlueprintFunctionLibrary` subclass. Python calls the static function directly via UE4's Python bindings. The MCP server adds one new tool that validates input and routes through `python_proxy` -- no new HTTP routes, no Python listener changes.

**Tech Stack:** C++17, UE4.27 editor APIs (BlueprintGraph, KismetCompiler, UnrealEd), TypeScript (zod), UE4 Python bindings.

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-design.md`

---

## File Map

**Create (C++ plugin):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/BlueprintGraphBuilder.uplugin`
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs`
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h`
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderModule.cpp`
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Modify (MCP server):**
- `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts` -- add `blueprint_build_from_json` tool
- `D:/UE/UE_Bridge/mcp-server/src/index.ts` -- register `blueprint_build_from_json` in modifyingCommands
- `D:/UE/UE_Bridge/mcp-server/src/tools/system.ts` -- add `blueprint_build_from_json` to TOOL_DOCS map

---

## Task 1: Create Plugin Scaffold

**Files:**
- Create: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/BlueprintGraphBuilder.uplugin`
- Create: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs`
- Create: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderModule.cpp`

**Context:** UE4 auto-discovers plugins in `Plugins/`. The plugin needs an `.uplugin`, a `Build.cs` for its module dependencies, and a minimal module `.cpp` that satisfies the `IModuleInterface` requirement for an Editor plugin.

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public"
mkdir -p "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private"
```

- [ ] **Step 2: Write `.uplugin`**

Path: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/BlueprintGraphBuilder.uplugin`

```json
{
  "FileVersion": 3,
  "Version": 1,
  "VersionName": "1.0",
  "FriendlyName": "Blueprint Graph Builder",
  "Description": "Builds Blueprint graphs from JSON descriptions.",
  "Category": "Editor",
  "EnabledByDefault": true,
  "Modules": [
    {
      "Name": "BlueprintGraphBuilder",
      "Type": "Editor",
      "LoadingPhase": "Default"
    }
  ]
}
```

- [ ] **Step 3: Write `Build.cs`**

Path: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs`

```csharp
using UnrealBuildTool;

public class BlueprintGraphBuilder : ModuleRules
{
    public BlueprintGraphBuilder(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "UnrealEd",
            "BlueprintGraph",
            "KismetCompiler",
            "Kismet",
            "GraphEditor",
            "Json",
            "JsonUtilities",
        });
    }
}
```

- [ ] **Step 4: Write module `.cpp`**

Path: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderModule.cpp`

```cpp
#include "Modules/ModuleManager.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, BlueprintGraphBuilder)
```

- [ ] **Step 5: Verify directory structure**

```bash
find "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder" -type f
```

Expected output (4 files):
```
.../BlueprintGraphBuilder.uplugin
.../Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs
.../Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderModule.cpp
```
(Public/ directory exists but is empty -- that's correct for now.)

---

## Task 2: Write the Library Header

**Files:**
- Create: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h`

**Context:** This is the entire public API of the plugin. UHT (Unreal Header Tool) will process the `UCLASS`/`UFUNCTION` macros and generate Python bindings. The `BLUEPRINTGRAPHBUILDER_API` export macro must match the module name (uppercase, underscores become underscores).

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "BlueprintGraphBuilderLibrary.generated.h"

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UBlueprintGraphBuilderLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /**
     * Builds a Blueprint event graph from a JSON description.
     *
     * JSON format:
     * {
     *   "nodes": [{"id": "start", "type": "BeginPlay"}, {"id": "print", "type": "PrintString"}],
     *   "connections": [{"from": "start.exec", "to": "print.exec"}]
     * }
     *
     * Supported types (Pass 1): BeginPlay, PrintString
     * Connection pin roles: exec (output Then on source, input Execute on target)
     */
    UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
    static void BuildBlueprintFromJSON(
        UBlueprint* Blueprint,
        const FString& JsonString,
        bool bClearExistingGraph = true
    );
};
```

---

## Task 3: Write the Library Implementation

**Files:**
- Create: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** This is the entire logic of the plugin. Read the execution flow in the spec carefully before writing. Key gotchas:
- `bOverrideFunction = true` is REQUIRED on `UK2Node_Event` or the Blueprint compile fails with "Missing Event 'ReceiveBeginPlay'"
- Use `FBlueprintEditorUtils::RemoveNode` in a loop (NOT `Graph->Nodes.Empty()`) -- raw clear leaves dangling pin pointers
- `FJsonSerializer::Deserialize` takes a `TJsonReader`, not a raw `FString`
- Mark blueprint BEFORE compile: `MarkBlueprintAsStructurallyModified` then `CompileBlueprint`

- [ ] **Step 1: Write the implementation**

```cpp
#include "BlueprintGraphBuilderLibrary.h"

#include "EdGraph/EdGraph.h"
#include "EdGraphSchema_K2.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "K2Node_Event.h"
#include "K2Node_CallFunction.h"
#include "Kismet/KismetSystemLibrary.h"
#include "GameFramework/Actor.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

void UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON(
    UBlueprint* Blueprint,
    const FString& JsonString,
    bool bClearExistingGraph)
{
    if (!Blueprint)
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Blueprint is null"));
        return;
    }

    // --- Step 1: Parse JSON ---
    TSharedPtr<FJsonObject> RootObject;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);
    if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Invalid JSON: %s"), *JsonString);
        return;
    }

    // --- Step 2: Get event graph ---
    UEdGraph* Graph = FBlueprintEditorUtils::FindEventGraph(Blueprint);
    if (!Graph && Blueprint->UbergraphPages.Num() > 0)
    {
        Graph = Blueprint->UbergraphPages[0];
    }
    if (!Graph)
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: No event graph found on Blueprint"));
        return;
    }

    // --- Step 3: Clear existing nodes ---
    if (bClearExistingGraph)
    {
        TArray<UEdGraphNode*> NodesToRemove = Graph->Nodes;
        for (UEdGraphNode* Node : NodesToRemove)
        {
            FBlueprintEditorUtils::RemoveNode(Blueprint, Node, /*bDontRecompile=*/true);
        }
    }

    // --- Step 4: Spawn nodes ---
    const TArray<TSharedPtr<FJsonValue>>* NodesArray = nullptr;
    if (!RootObject->TryGetArrayField(TEXT("nodes"), NodesArray))
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Missing 'nodes' array"));
        return;
    }

    TMap<FString, UEdGraphNode*> NodeMap;

    for (const TSharedPtr<FJsonValue>& NodeValue : *NodesArray)
    {
        const TSharedPtr<FJsonObject>* NodeObj = nullptr;
        if (!NodeValue->TryGetObject(NodeObj))
        {
            continue;
        }

        FString NodeId, NodeType;
        (*NodeObj)->TryGetStringField(TEXT("id"), NodeId);
        (*NodeObj)->TryGetStringField(TEXT("type"), NodeType);

        if (NodeId.IsEmpty() || NodeType.IsEmpty())
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Skipping node with missing id or type"));
            continue;
        }

        UEdGraphNode* SpawnedNode = nullptr;

        if (NodeType == TEXT("BeginPlay"))
        {
            FGraphNodeCreator<UK2Node_Event> Creator(*Graph);
            UK2Node_Event* EventNode = Creator.CreateNode();
            EventNode->EventReference.SetExternalMember(
                GET_FUNCTION_NAME_CHECKED(AActor, ReceiveBeginPlay),
                AActor::StaticClass()
            );
            EventNode->bOverrideFunction = true;
            EventNode->NodePosX = 0;
            EventNode->NodePosY = 0;
            Creator.Finalize();
            SpawnedNode = EventNode;
        }
        else if (NodeType == TEXT("PrintString"))
        {
            UFunction* Func = UKismetSystemLibrary::StaticClass()->FindFunctionByName(TEXT("PrintString"));
            if (!Func)
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: PrintString function not found"));
                return;
            }
            FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
            UK2Node_CallFunction* CallNode = Creator.CreateNode();
            CallNode->SetFromFunction(Func);
            CallNode->NodePosX = 300;
            CallNode->NodePosY = 0;
            Creator.Finalize();
            SpawnedNode = CallNode;
        }
        else
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
            continue;
        }

        NodeMap.Add(NodeId, SpawnedNode);
    }

    // --- Step 5: Wire connections ---
    const TArray<TSharedPtr<FJsonValue>>* ConnectionsArray = nullptr;
    if (RootObject->TryGetArrayField(TEXT("connections"), ConnectionsArray))
    {
        for (const TSharedPtr<FJsonValue>& ConnValue : *ConnectionsArray)
        {
            const TSharedPtr<FJsonObject>* ConnObj = nullptr;
            if (!ConnValue->TryGetObject(ConnObj))
            {
                continue;
            }

            FString FromStr, ToStr;
            (*ConnObj)->TryGetStringField(TEXT("from"), FromStr);
            (*ConnObj)->TryGetStringField(TEXT("to"), ToStr);

            // Parse "nodeId.pinRole"
            FString FromNodeId, FromPinRole, ToNodeId, ToPinRole;
            FromStr.Split(TEXT("."), &FromNodeId, &FromPinRole);
            ToStr.Split(TEXT("."), &ToNodeId, &ToPinRole);

            UEdGraphNode** FromNodePtr = NodeMap.Find(FromNodeId);
            UEdGraphNode** ToNodePtr = NodeMap.Find(ToNodeId);
            if (!FromNodePtr || !ToNodePtr)
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Connection references unknown node(s): %s -> %s"), *FromStr, *ToStr);
                continue;
            }

            // For exec connections: source uses PN_Then (output), target uses PN_Execute (input)
            UEdGraphPin* SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
            UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);

            if (!SourcePin || !TargetPin)
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Could not find exec pins for connection %s -> %s"), *FromStr, *ToStr);
                continue;
            }

            SourcePin->MakeLinkTo(TargetPin);
        }
    }

    // --- Step 6: Mark and compile ---
    FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
    FKismetEditorUtilities::CompileBlueprint(Blueprint);
    Blueprint->MarkPackageDirty();

    UE_LOG(LogTemp, Log, TEXT("BuildBlueprintFromJSON: Done. %d nodes spawned."), NodeMap.Num());
}
```

---

## Task 4: Compile the Plugin

**Context:** First compile happens by opening the UE4 editor with the project -- it detects the new plugin and compiles automatically. This is faster and gives better error messages than Build.bat for the first iteration.

- [ ] **Step 1: Open CodePlayground in UE4.27**

**This is a manual step -- cannot be scripted.** Double-click `D:/Unreal Projects/CodePlayground/CodePlayground.uproject` in Explorer, or launch from the Epic Games Launcher.

When prompted "The following modules are missing or built with a different engine version: BlueprintGraphBuilder. Would you like to rebuild them now?" -- click **Yes**.

- [ ] **Step 2: Check for compile errors**

Watch the compile output in the editor. If errors appear:
- "Cannot open include file" errors -> check `Build.cs` module list vs. required includes in spec
- "'UK2Node_Event': base class undefined" -> `BlueprintGraph` missing from `PrivateDependencyModuleNames`
- "BLUEPRINTGRAPHBUILDER_API: undeclared identifier" -> the export macro must match the module name exactly (module name in Build.cs constructor is `BlueprintGraphBuilder`, so macro is `BLUEPRINTGRAPHBUILDER_API`)

- [ ] **Step 3: Verify Python exposure**

Open the UE4 Output Log and run in the Python console (or via `python_proxy`):

```python
import unreal
print(dir(unreal.BlueprintGraphBuilderLibrary))
```

Expected: `build_blueprint_from_json` appears in the output.

If the class is not found, the plugin may not be enabled. Check `Edit > Plugins > Project > BlueprintGraphBuilder` -- enable if not already enabled and restart.

---

## Task 5: Smoke Test via Python

**Context:** Before wiring up the MCP tool, confirm the C++ function works end-to-end from Python. This isolates plugin bugs from MCP plumbing bugs.

You need an existing Blueprint asset in CodePlayground. Create one if none exists: Content Browser > right-click > Blueprint Class > Actor > name it `BP_TestGraph`.

- [ ] **Step 1: Confirm a test Blueprint exists**

Via `python_proxy`:
```python
import unreal
bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
print(bp)
```

If `None`, create one first:
```python
import unreal
factory = unreal.BlueprintFactory()
factory.set_editor_property("parent_class", unreal.Actor)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
bp = asset_tools.create_asset("BP_TestGraph", "/Game/", unreal.Blueprint, factory)
unreal.EditorAssetLibrary.save_asset("/Game/BP_TestGraph.BP_TestGraph")
print(bp)
```

- [ ] **Step 2: Call the function directly via python_proxy**

```python
import unreal, json

bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
if not bp:
    raise Exception("Blueprint not found")

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
    True
)
print("Done")
```

Expected: "Done" printed. No Python exceptions. UE4 Output Log shows "BuildBlueprintFromJSON: Done. 2 nodes spawned."

- [ ] **Step 3: Verify in editor**

Open `BP_TestGraph` in the Blueprint editor. The event graph should show:
- An `Event BeginPlay` node
- A `Print String` node
- An exec wire connecting BeginPlay's output to PrintString's input

If the graph is empty or nodes are not connected, check the UE4 Output Log for warning/error messages from `BuildBlueprintFromJSON`.

- [ ] **Step 4: Negative test -- malformed JSON**

Via `python_proxy`:
```python
import unreal
bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, "not valid json", True)
print("Negative test done")
```

Expected: no Python exception (the function should log an error and return gracefully). Check UE4 Output Log for "BuildBlueprintFromJSON: Invalid JSON". The Blueprint graph should be unchanged from the previous test (nodes cleared, then nothing added since parse failed).

- [ ] **Step 5: Test Play**

Click the Play button in the UE4 editor. The screen should show a debug string (the default `Print String` value). If nothing appears, check: Output Log for Kismet compile errors, that the Blueprint is placed in the level (if not already in the level, drag `BP_TestGraph` from Content Browser into the viewport first).

---

## Task 6: Add MCP Tool

**Files:**
- Modify: `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts`
- Modify: `D:/UE/UE_Bridge/mcp-server/src/index.ts`

**Context:** The tool follows the exact pattern of existing tools in `blueprints.ts`. The handler uses `python_proxy` (via `client.sendCommand("python_proxy", { code: ... })`) rather than adding a new command -- this keeps the Python listener unchanged. JSON is embedded in a Python `json.loads('...')` call with single-quote escaping.

- [ ] **Step 1: Add the tool to `blueprints.ts`**

Append before the closing `];` of the `return` array in `createBlueprintTools`:

```typescript
{
  name: "blueprint_build_from_json",
  description:
    "Builds a Blueprint event graph from a JSON node/connection description. " +
    "Supported node types (Pass 1): BeginPlay, PrintString. " +
    "Connections use 'nodeId.exec' format for exec pin wiring.",
  inputSchema: z.object({
    blueprint_path: z
      .string()
      .startsWith("/")
      .describe("Content path of the Blueprint, e.g. /Game/BP_TestGraph.BP_TestGraph"),
    graph: z.object({
      nodes: z.array(
        z.object({
          id: z.string().describe("Unique node identifier"),
          type: z.string().describe("Node type: BeginPlay or PrintString"),
        })
      ),
      connections: z.array(
        z.object({
          from: z.string().describe("Source node and pin role: nodeId.exec"),
          to: z.string().describe("Target node and pin role: nodeId.exec"),
        })
      ),
    }),
    clear_existing: z.boolean().default(true).describe("Clear existing graph before building"),
  }),
  handler: async (params) => {
    const { blueprint_path, graph, clear_existing } = params as {
      blueprint_path: string;
      graph: { nodes: Array<{ id: string; type: string }>; connections: Array<{ from: string; to: string }> };
      clear_existing: boolean;
    };

    // Escape for safe embedding in Python single-quoted strings
    const escapedPath = blueprint_path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const graphJson = JSON.stringify(graph)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");
    const clearFlag = (clear_existing ?? true) ? "True" : "False";

    const code = `\
import unreal
bp = unreal.load_object(None, '${escapedPath}')
if not bp:
    raise Exception('Blueprint not found at path: ${escapedPath}')
unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, '${graphJson}', ${clearFlag})
print('blueprint_build_from_json: done')
`;
    // Note: graphJson is already a valid JSON string -- pass it directly to C++.
    // The C++ function calls FJsonSerializer::Deserialize internally, so no Python
    // json.loads/json.dumps roundtrip is needed.

    const result = await client.sendCommand("python_proxy", { code });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
},
```

- [ ] **Step 2: Register in `modifyingCommands` in `index.ts`**

In `index.ts`, find the `modifyingCommands` set (around line 58-64) and add `"blueprint_build_from_json"`:

```typescript
const modifyingCommands = new Set([
  "actor_spawn", "actor_modify", "actor_delete", "actor_duplicate",
  "actor_organize", "actor_snap_to_socket", "batch_spawn",
  "material_create", "material_apply",
  "blueprint_create", "blueprint_compile", "blueprint_build_from_json",
  "level_save",
]);
```

- [ ] **Step 3: Add to `TOOL_DOCS` in `system.ts`**

In `system.ts`, add to the `TOOL_DOCS` map:

```typescript
blueprint_build_from_json: {
  description: "Build a Blueprint event graph from a JSON node/connection description",
  params: "blueprint_path (string), graph (object with nodes[] and connections[]), clear_existing? (bool)"
},
```

- [ ] **Step 4: Build the MCP server**

```bash
cd D:/UE/UE_Bridge && npm run build
```

Expected: no TypeScript errors. `mcp-server/dist/index.js` updated.

---

## Task 7: End-to-End MCP Test

**Context:** Confirm the full pipeline: MCP tool -> TypeScript handler -> python_proxy -> C++ plugin -> Blueprint graph. This is the Pass 1 milestone.

- [ ] **Step 1: Restart the MCP server**

If Claude Code is using the MCP server, restart it to pick up the new build:
```bash
# The MCP server auto-restarts when Claude Code reconnects, or restart from Claude Code settings
```

Or confirm the new tool is visible: call `help` tool and look for `blueprint_build_from_json` in the output.

- [ ] **Step 2: Call the MCP tool**

Via the `blueprint_build_from_json` MCP tool (not python_proxy):

```json
{
  "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
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

Expected response: `success: true`, python output includes `"blueprint_build_from_json: done"`.

- [ ] **Step 3: Verify in Blueprint editor**

Open `BP_TestGraph` in UE4. Graph should show BeginPlay connected to Print String.

- [ ] **Step 4: Test Play**

Hit Play in UE4. Debug text should appear on screen.

- [ ] **Step 5: Commit**

```bash
cd D:/UE/UE_Bridge
git add mcp-server/src/tools/blueprints.ts mcp-server/src/index.ts mcp-server/src/tools/system.ts mcp-server/dist/
git commit -m "feat: add blueprint_build_from_json MCP tool"
```

The C++ plugin files live in `D:/Unreal Projects/CodePlayground/` which is a separate repo/directory -- commit those separately if that project is under version control.

---

## Troubleshooting Reference

### Plugin compile errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot open include file: 'K2Node_Event.h'` | `BlueprintGraph` not in PrivateDependencyModuleNames | Add to Build.cs |
| `'FBlueprintEditorUtils': is not a class or namespace` | `UnrealEd` not in PrivateDependencyModuleNames | Add to Build.cs |
| `BLUEPRINTGRAPHBUILDER_API: undeclared identifier` | Export macro mismatch | Macro must match module name exactly |
| `error C2039: 'ReceiveBeginPlay': is not a member of 'AActor'` | Missing `GameFramework/Actor.h` include | Add include |

### Runtime errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Missing Event 'ReceiveBeginPlay'" in Kismet compile | `bOverrideFunction` not set to `true` | Add `EventNode->bOverrideFunction = true;` before `Creator.Finalize()` |
| Blueprint graph empty after call | JSON parse failed silently | Check Output Log for "BuildBlueprintFromJSON: Invalid JSON" |
| Nodes present but not connected | Pin name lookup failed | Check Output Log for "Could not find exec pins" |
| Python: `AttributeError: type object 'BlueprintGraphBuilderLibrary' has no attribute` | Plugin not enabled or not compiled | Check Edit > Plugins, recompile |

### MCP tool errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| Python syntax error in python_proxy | Single quote in JSON content not escaped | Check escape regex in handler |
| `Blueprint not found` exception | Wrong path format | Path must include object name: `/Game/BP_Test.BP_Test` not `/Game/BP_Test` |
