# Blueprint Graph Builder Plugin -- Design Spec
Date: 2026-03-17

## Overview

A project-level UE4.27 Editor C++ plugin that exposes one static function:
`BuildBlueprintFromJSON(Blueprint, JsonString, bClearExistingGraph)`.

The function receives a JSON description of a Blueprint graph and physically
constructs the node graph inside the editor -- spawning nodes, wiring pins,
and compiling. It is callable from Python via the existing UE Bridge MCP
pipeline. The plugin knows nothing about MCP or AI; it is a dumb executor.

## Goals (Pass 1)

- Plugin compiles against CodePlayground project without engine rebuild
- Supports exactly two node types: BeginPlay, PrintString
- Connects exec pins between those nodes
- Compiles the target Blueprint
- Callable from Python via `unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json`
- New MCP tool `blueprint_build_from_json` routes through python_proxy to the plugin

## Non-Goals (Pass 1)

- Arbitrary node types
- Data pin wiring
- Node positioning (x/y layout)
- Error recovery or partial graph builds
- Generic node factory via reflection

---

## Plugin Structure

Location: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/`

```
Plugins/BlueprintGraphBuilder/
├── BlueprintGraphBuilder.uplugin
└── Source/
    └── BlueprintGraphBuilder/
        ├── BlueprintGraphBuilder.Build.cs
        ├── Public/
        │   └── BlueprintGraphBuilderLibrary.h
        └── Private/
            ├── BlueprintGraphBuilderModule.cpp
            └── BlueprintGraphBuilderLibrary.cpp
```

Plugin type: Editor. LoadingPhase: Default.
No UI, no assets, no custom editor tabs.

---

## .uplugin

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

---

## Build.cs Dependencies

PublicDependencyModuleNames: `Core`, `CoreUObject`, `Engine`

PrivateDependencyModuleNames: `UnrealEd`, `BlueprintGraph`, `KismetCompiler`,
`Kismet`, `GraphEditor`, `Json`, `JsonUtilities`

`UnrealEd`, `BlueprintGraph`, `KismetCompiler`, `Kismet`, and `GraphEditor`
are private because they are editor-only and not part of the plugin's
public interface.

---

## C++ Surface Area

### Header (`BlueprintGraphBuilderLibrary.h`)

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
    UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
    static void BuildBlueprintFromJSON(
        UBlueprint* Blueprint,
        const FString& JsonString,
        bool bClearExistingGraph = true
    );
};
```

`UFUNCTION(BlueprintCallable)` exposes the function to UE4's Python bindings
as: `unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json_str, True)`

Note: `CallInEditor` is omitted. That specifier is for actor instance methods
shown in the Details panel -- it has no meaning on a static library function
and would mislead readers.

---

## JSON Schema (Pass 1)

```json
{
  "nodes": [
    { "id": "start", "type": "BeginPlay" },
    { "id": "print", "type": "PrintString" }
  ],
  "connections": [
    { "from": "start.exec", "to": "print.exec" }
  ]
}
```

### Node types supported in Pass 1

| type         | UE4 class             | Notes                              |
|--------------|-----------------------|------------------------------------|
| BeginPlay    | UK2Node_Event         | Bound to AActor::ReceiveBeginPlay  |
| PrintString  | UK2Node_CallFunction  | Bound to UKismetSystemLibrary::PrintString |

Connection format: `"nodeId.pinRole"` where pinRole is `exec` (output exec on
source, input exec on target). Pass 1 supports only exec connections.

Unknown node types are logged as errors and skipped. Malformed JSON causes
early return with logged error. Neither case crashes the editor.

---

## Required Includes (`BlueprintGraphBuilderLibrary.cpp`)

```cpp
#include "BlueprintGraphBuilderLibrary.h"
#include "EdGraph/EdGraph.h"                         // FGraphNodeCreator, UEdGraph
#include "EdGraphSchema_K2.h"                        // PN_Execute, PN_Then
#include "Kismet2/BlueprintEditorUtils.h"            // FindEventGraph, MarkBlueprintAsStructurallyModified, RemoveNode
#include "Kismet2/KismetEditorUtilities.h"           // CompileBlueprint
#include "K2Node_Event.h"                            // UK2Node_Event
#include "K2Node_CallFunction.h"                     // UK2Node_CallFunction
#include "Kismet/KismetSystemLibrary.h"              // UKismetSystemLibrary::StaticClass
#include "GameFramework/Actor.h"                     // AActor, GET_FUNCTION_NAME_CHECKED(AActor, ReceiveBeginPlay)
#include "Dom/JsonObject.h"                          // TSharedPtr<FJsonObject>
#include "Serialization/JsonReader.h"                // TJsonReaderFactory
#include "Serialization/JsonSerializer.h"            // FJsonSerializer
```

`BlueprintEditorUtils.h` transitively pulls in `EdGraphSchema_K2.h` and
`EdGraph/EdGraph.h` in practice, but explicit includes are listed above for
clarity and compile-order safety.

---

## Internal Execution Flow

`BuildBlueprintFromJSON` runs on the game thread (called from Python which
runs on the game thread). Steps:

1. **Parse JSON** -- wrap `JsonString` in a reader factory, then deserialize:
   ```cpp
   TSharedPtr<FJsonObject> RootObject;
   TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);
   if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
   {
       UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: invalid JSON"));
       return;
   }
   ```
   `FJsonSerializer::Deserialize` takes a `TJsonReader`, not a raw `FString`.

2. **Get graph** -- `FBlueprintEditorUtils::FindEventGraph(Blueprint)`.
   Fallback to `Blueprint->UbergraphPages[0]` if null. If still null, log
   error and return.

3. **Clear existing graph** (if `bClearExistingGraph`) -- iterate a copy of
   `Graph->Nodes` and remove each node properly:
   ```cpp
   TArray<UEdGraphNode*> NodesToRemove = Graph->Nodes;
   for (UEdGraphNode* Node : NodesToRemove)
   {
       FBlueprintEditorUtils::RemoveNode(Blueprint, Node, /*bDontRecompile=*/true);
   }
   ```
   Do NOT use `Graph->Nodes.Empty()` directly -- it bypasses `Schema->BreakNodeLinks`
   and `Node->DestroyNode()`, leaving dangling pin pointers that can crash the
   compiler. Default event nodes do NOT regenerate automatically after a raw clear;
   `RemoveNode` handles cleanup correctly.

4. **Spawn nodes** -- iterate JSON nodes array, dispatch on `type`:

   **BeginPlay:**
   ```cpp
   FGraphNodeCreator<UK2Node_Event> Creator(*Graph);
   UK2Node_Event* Node = Creator.CreateNode();
   Node->EventReference.SetExternalMember(
       GET_FUNCTION_NAME_CHECKED(AActor, ReceiveBeginPlay),
       AActor::StaticClass()
   );
   Node->bOverrideFunction = true;   // required -- without this, ValidateNodeDuringCompilation
                                     // looks for CustomFunctionName (NAME_None) and fails
                                     // with "Missing Event 'ReceiveBeginPlay'"
   Creator.Finalize();
   ```

   **PrintString:**
   ```cpp
   FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
   UK2Node_CallFunction* Node = Creator.CreateNode();
   UFunction* Func = UKismetSystemLibrary::StaticClass()
       ->FindFunctionByName(TEXT("PrintString"));
   if (!Func) { UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: PrintString function not found")); return; }
   Node->SetFromFunction(Func);
   Creator.Finalize();
   ```

   Store each node in `TMap<FString, UEdGraphNode*>` keyed by `id`.

5. **Wire connections** -- for each connection in JSON:
   - Parse `"nodeId.pinRole"` format
   - Look up nodes by id in the map
   - For the source (`exec` role): find pin with `UEdGraphSchema_K2::PN_Then`
   - For the target (`exec` role): find pin with `UEdGraphSchema_K2::PN_Execute`
   - Call `SourcePin->MakeLinkTo(TargetPin)`
   - Log and skip if either pin is not found

6. **Mark and compile:**
   ```cpp
   FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
   FKismetEditorUtilities::CompileBlueprint(Blueprint);
   ```
   Order matters: mark before compile.

---

## MCP Tool

File: `mcp-server/src/tools/blueprints.ts` (added to existing file)

### Tool definition

```ts
{
  name: "blueprint_build_from_json",
  description: "Builds a Blueprint event graph from a JSON node/connection description.",
  inputSchema: z.object({
    blueprint_path: z.string().describe("Content path, e.g. /Game/BP_Test.BP_Test"),
    graph: z.object({
      nodes: z.array(z.object({
        id: z.string(),
        type: z.string()
      })),
      connections: z.array(z.object({
        from: z.string(),
        to: z.string()
      }))
    }),
    clear_existing: z.boolean().default(true)
  })
}
```

### Handler

1. Escape `blueprint_path` and serialized `graph` for safe embedding in Python single-quoted strings:
   ```ts
   const escapedPath = blueprint_path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
   const graphJson = JSON.stringify(params.graph).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
   const clearFlag = (clear_existing ?? true) ? "True" : "False";
   ```
2. Call `python_proxy` passing `graphJson` directly as the JSON string argument to C++:

```python
import unreal
bp = unreal.load_object(None, '{escapedPath}')
if not bp:
    raise Exception('Blueprint not found at path: {escapedPath}')
unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, '{graphJson}', {clearFlag})
```

`{graphJson}` is the TypeScript-escaped JSON string. It is passed directly to the
C++ function, which calls `FJsonSerializer::Deserialize` internally. No Python
`json.loads`/`json.dumps` roundtrip is needed.

`clear_existing ?? true` provides the default since params bypass `schema.parse()`
in this codebase and Zod defaults do not auto-apply.

### Registration

Added to the modifying commands list in `index.ts` so it participates in
undo history tracking.

---

## Build Process

No engine rebuild. After adding plugin files:

1. Open CodePlayground in UE4 editor once -- it detects the new plugin and
   compiles it automatically on first load. This is faster than Build.bat for
   the initial compilation.

2. For subsequent rebuilds:
   ```
   D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat \
     CodePlaygroundEditor Win64 Development \
     -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" \
     -WaitMutex -FromMsBuild
   ```

The `.uproject` does not need manual editing. UE4 auto-discovers plugins in
`Plugins/`.

---

## Validation Criteria (Pass 1 complete when)

- Plugin compiles without errors or warnings
- Python call `unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json_str, True)` executes without exception
- Target Blueprint's event graph contains a BeginPlay node connected to a PrintString node
- Blueprint compiles cleanly (no Kismet errors)
- Hitting Play in editor (Development build) produces text output on screen
  (note: `PrintString` is `DevelopmentOnly` and is stripped in Shipping builds)
- MCP tool `blueprint_build_from_json` produces same result end-to-end

---

## Future Expansion (not in scope now)

- Pass 2: EventHit + SetSimulatePhysics (component target pins, function lookup)
- Pass 3: Arbitrary function lookup via reflection, generic node factory
- Node positioning (x/y layout in JSON)
- Data pin wiring (string/float/bool inputs on nodes)
- Graph templates and caching (potential migration to UEditorSubsystem)
