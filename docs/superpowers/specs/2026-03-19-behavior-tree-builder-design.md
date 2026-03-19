# Phase 3b: Behavior Tree Node Graph Builder -- Design Spec

**Date:** 2026-03-19
**Status:** Design approved, implementation not started
**Depends on:** Phase 2 (merged), BlueprintGraphBuilder C++ plugin (11 passes complete)
**Produces:** Working BT node graphs from JSON, enemy patrol+chase loop in PIE

---

## Problem

The `enemy_patrol` mechanic generates BehaviorTree assets that are empty shells. `generate_behavior_tree()` in `ai_generator.py` creates the UBehaviorTree, assigns the blackboard, but ignores `BehaviorTreeSpec.root`. The BT has no nodes, so enemies do nothing in PIE.

The pipeline is broken at the last step:

```
Prompt -> Intent -> Mechanics -> Spec -> Assets -> [empty BT] -> no AI behavior
```

## Solution

Build a C++ `BehaviorTreeBuilderLibrary` inside the existing BlueprintGraphBuilder plugin. It takes a JSON description of the BT structure and constructs the full runtime node graph: composites, tasks, decorators, blackboard key bindings. After building runtime nodes, it reconstructs the editor graph so the BT is inspectable in the editor.

**Design rule:** The runtime Behavior Tree is the source of truth. The editor graph is derived from it. JSON builds runtime nodes. Editor graph reconstructs from them. If editor sync fails, the runtime tree remains valid.

---

## Architecture

### Data flow

```
BehaviorTreeSpec.root (Python dict)
  -> json.dumps()
  -> BuildBehaviorTreeFromJSON (C++)
    -> FBTJsonParser: JSON string -> FBTBuildSpec
    -> FBTValidator: structural + BB key validation
    -> FBTNodeFactory: create runtime UBT nodes (two-phase: create then wire)
    -> FBTEditorGraphSync: reconstruct editor graph from runtime tree
  -> save asset
```

### New C++ files

All under `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`:

| File | Purpose |
|---|---|
| `Public/BehaviorTreeBuilderLibrary.h` | Public API: `BuildBehaviorTreeFromJSON(UBehaviorTree*, FString)` |
| `Private/BehaviorTreeBuilder/BTBuildSpec.h` | `FBTNodeSpec`, `FBTBuildSpec`, `FBTBuildContext` structs |
| `Private/BehaviorTreeBuilder/BTJsonParser.h/cpp` | JSON to `FBTBuildSpec` |
| `Private/BehaviorTreeBuilder/BTNodeRegistry.h/cpp` | Type maps (composite/task/decorator), defaults, BB key requirements |
| `Private/BehaviorTreeBuilder/BTValidator.h/cpp` | Validates spec against registry and blackboard |
| `Private/BehaviorTreeBuilder/BTNodeFactory.h/cpp` | Creates and wires UBT nodes |
| `Private/BehaviorTreeBuilder/BTBuilder.h/cpp` | Orchestrator: parse, validate, build, sync |
| `Private/BehaviorTreeBuilder/BTEditorGraphSync.h/cpp` | Reconstructs editor graph from runtime tree |
| `Private/BehaviorTreeBuilderLibrary.cpp` | Thin wrapper around FBTBuilder |

### Modified files

| File | Change |
|---|---|
| `BlueprintGraphBuilder.Build.cs` | Add `AIModule`, `GameplayTasks`, `BehaviorTreeEditor` dependencies |
| `ai_generator.py` | Call `BuildBehaviorTreeFromJSON` after creating BT asset |
| `enemy_patrol.py` | Upgrade `BehaviorTreeSpec.root` to full JSON schema |
| `spec_schema.py` | Update `BehaviorTreeSpec.root` docstring to match new JSON schema |
| `test_mechanics.py` (existing at `unreal-plugin/Content/Python/tests/test_mechanics.py`) | Add assertions for new root structure (id, decorators, params) |

### No TypeScript changes

The MCP tool interface is unchanged. `prompt_generate` still calls `prompt_to_spec()` which calls mechanics which produce `BuildSpec`. The only difference is that BT assets now have node graphs.

---

## JSON Schema

Input to `BuildBehaviorTreeFromJSON`. Wrapped in `{"root": ...}` at the top level.

### Node structure

Every node has:

```json
{
  "id": "unique_string",
  "type": "Selector|Sequence|MoveTo|Wait|Blackboard",
  "name": "OptionalDisplayName",
  "params": {},
  "children": [],
  "decorators": [],
  "services": []
}
```

- `id` -- required, unique within the tree. Used for debugging, error paths, and future node mapping.
- `type` -- required, must match a key in the registry. Unknown types are hard errors.
- `name` -- optional, display name shown in editor.
- `params` -- node-specific parameters, parsed to `TMap<FString, FString>` at parse time.
- `children` -- only valid for composite nodes. Tasks with children are errors.
- `decorators` -- array of decorator nodes attached to this node.
- `services` -- parsed and stored but ignored in MVP. Reserved for future use. Service entries are accepted without type validation in MVP; future passes will validate service types against the registry.

### Example: Enemy patrol + chase

```json
{
  "root": {
    "id": "root_selector",
    "type": "Selector",
    "name": "EnemyBehavior",
    "children": [
      {
        "id": "chase_sequence",
        "type": "Sequence",
        "name": "ChasePlayer",
        "decorators": [
          {
            "id": "has_target",
            "type": "Blackboard",
            "name": "HasTarget",
            "params": {
              "blackboard_key": "TargetActor",
              "condition": "IsSet"
            }
          }
        ],
        "children": [
          {
            "id": "move_to_target",
            "type": "MoveTo",
            "name": "ChaseTarget",
            "params": {
              "blackboard_key": "TargetActor",
              "acceptable_radius": 100.0
            }
          }
        ]
      },
      {
        "id": "patrol_sequence",
        "type": "Sequence",
        "name": "Patrol",
        "decorators": [
          {
            "id": "no_target",
            "type": "Blackboard",
            "name": "NoTarget",
            "params": {
              "blackboard_key": "TargetActor",
              "condition": "IsNotSet"
            }
          }
        ],
        "children": [
          {
            "id": "move_to_patrol",
            "type": "MoveTo",
            "name": "GoToPatrolPoint",
            "params": {
              "blackboard_key": "PatrolLocation",
              "acceptable_radius": 50.0
            }
          },
          {
            "id": "patrol_wait",
            "type": "Wait",
            "name": "WaitAtPoint",
            "params": {
              "wait_time": 2.0,
              "random_deviation": 1.0
            }
          }
        ]
      }
    ]
  }
}
```

### Supported node types (MVP)

| JSON type | UE4 class | Category |
|---|---|---|
| `Selector` | `UBTComposite_Selector` | Composite |
| `Sequence` | `UBTComposite_Sequence` | Composite |
| `MoveTo` | `UBTTask_MoveTo` | Task |
| `Wait` | `UBTTask_Wait` | Task |
| `Blackboard` | `UBTDecorator_Blackboard` | Decorator |

### Parameter definitions

**MoveTo:**
- `blackboard_key` (string) -- maps to `BlackboardKey.SelectedKeyName`. BB key must be Object or Vector type.
- `acceptable_radius` (float, default 50.0)

**Wait:**
- `wait_time` (float, default 5.0)
- `random_deviation` (float, default 0.0)

**Blackboard decorator:**
- `blackboard_key` (string) -- BB key to check.
- `condition` (string) -- `"IsSet"` maps to `EBasicKeyOperation::Set`, `"IsNotSet"` maps to `EBasicKeyOperation::NotSet`. Invalid strings are hard errors. MVP supports only `EBasicKeyOperation`. Arithmetic operations (`Equal`, `Less`, `Greater`, etc. via `EArithmeticKeyOperation`) are deferred to a future pass.

### Execution order

Children are evaluated in array order (left to right). This determines Selector priority and Sequence flow.

---

## C++ Implementation Details

### FBTNodeSpec

```cpp
struct FBTNodeSpec
{
    FString Id;
    FString Type;
    FString Name;
    TMap<FString, FString> Params;       // converted from JSON at parse time
    TArray<FBTNodeSpec> Children;
    TArray<FBTNodeSpec> Decorators;
    TArray<FBTNodeSpec> Services;         // parsed, ignored in MVP
};
```

### FBTBuildSpec

```cpp
struct FBTBuildSpec
{
    FBTNodeSpec Root;
};
```

### FBTBuildContext

Passed through all build phases. Single source of state.

```cpp
struct FBTBuildContext
{
    UBehaviorTree* BehaviorTree;
    UBlackboardData* Blackboard;
    const FBTNodeRegistry* Registry;
    TMap<FString, UBTNode*> NodeMap;     // Id -> created node instance
};
```

### FBTNodeRegistry

Three separate maps by category:

```cpp
TMap<FString, TSubclassOf<UBTCompositeNode>> CompositeTypes;
TMap<FString, TSubclassOf<UBTTaskNode>> TaskTypes;
TMap<FString, TSubclassOf<UBTDecorator>> DecoratorTypes;
```

Plus:

```cpp
// Default params per type. Applied when param not specified in JSON.
TMap<FString, TMap<FString, FString>> DefaultParams;

// BB key type requirements per param per type.
// "MoveTo" -> {"blackboard_key" -> {"Object", "Vector"}}
TMap<FString, TMap<FString, TSet<FString>>> BBKeyTypeRequirements;
```

The registry also owns param application logic: `ApplyParams(UBTNode*, const TMap<FString, FString>&)`.

### FBTValidator

Accumulates all errors (does not fail-fast on first). Returns a TArray<FString>.

Validation rules:
1. Root must exist and must be a composite type (per registry).
2. Composites must have at least one child.
3. Task nodes cannot have children.
4. Only decorator types allowed in `decorators` arrays (per registry).
5. All `blackboard_key` param values must reference keys that exist in the BlackboardData asset.
6. BB key types must be compatible with what the node expects (per `BBKeyTypeRequirements`).
7. All `id` values must be unique within the tree.
8. `condition` enum values must be exactly `"IsSet"` or `"IsNotSet"`. No fallback.
9. Unknown `type` strings are hard errors.

### FBTNodeFactory

Two-phase build for safety:

**Phase A -- Create all nodes:**
Recursively walk `FBTBuildSpec`, create node objects via `NewObject<T>(BehaviorTree)` using the exact subclass from registry. Store in `FBTBuildContext::NodeMap` keyed by Id. Apply params via registry.

**Phase B -- Wire nodes:**
Recursively walk spec again, wire children into `UBTCompositeNode::Children` array and decorators into `Children[i].Decorators`.

Decorator attachment: Decorators defined on a composite node attach to that composite's execution. Decorators defined on a task node (child of a composite) attach via the composite's `FBTCompositeChild` entry for that child.

### FBTEditorGraphSync

Post-build step. Runs only if `GIsEditor` is true. The builder does NOT depend on editor graph sync -- this is a strictly post-build, one-way derivation.

Algorithm:

1. Get or create the editor graph:
   ```cpp
   UBehaviorTreeGraph* BTGraph = Cast<UBehaviorTreeGraph>(BT->BTGraph);
   if (!BTGraph)
   {
       BTGraph = CastChecked<UBehaviorTreeGraph>(
           FBlueprintEditorUtils::CreateNewGraph(BT, TEXT("BehaviorTreeGraph"),
               UBehaviorTreeGraph::StaticClass(), UEdGraphSchema_BehaviorTree::StaticClass()));
       BT->BTGraph = BTGraph;
   }
   ```
2. Clear existing editor graph nodes (remove all `UBTGraphNode` instances).
3. For each runtime node (composites, tasks, decorators), create a `UBTGraphNode`:
   ```cpp
   UBTGraphNode* GraphNode = NewObject<UBTGraphNode>(BTGraph);
   GraphNode->NodeInstance = RuntimeNode;
   BTGraph->AddNode(GraphNode, /*bFromUI=*/false, /*bSelectNewNode=*/false);
   ```
4. Connect parent-child pins via `UEdGraphPin::MakeLinkTo()` following the composite's `Children` array order.
5. For decorators, create `UBTGraphNode` and attach as sub-nodes of their parent graph node.
6. Call `BTGraph->UpdateAsset()` or equivalent to finalize layout.

If any step in sync fails, log a warning but do NOT fail the build. The runtime tree (`RootNode` and its children) is already committed and will execute correctly in PIE regardless of editor graph state.

**Module dependency:** `BehaviorTreeEditor` is required for `UBehaviorTreeGraph`, `UBTGraphNode`, and `UEdGraphSchema_BehaviorTree`.

### BTBuilder::Build() orchestration

```cpp
FString FBTBuilder::Build(UBehaviorTree* BT, const FString& JsonString)
{
    // 1. Parse
    FBTBuildSpec Spec;
    FString ParseError = FBTJsonParser::Parse(JsonString, Spec);
    if (!ParseError.IsEmpty()) return ParseError;

    // 2. Validate
    UBlackboardData* BB = BT->BlackboardAsset;
    TArray<FString> Errors = FBTValidator::Validate(Spec, Registry, BB);
    if (Errors.Num() > 0) return FString::Join(Errors, TEXT("\n"));

    // 3. Build runtime tree (two-phase, on temp context)
    FBTBuildContext Ctx;
    Ctx.BehaviorTree = BT;
    Ctx.Blackboard = BB;
    Ctx.Registry = &Registry;

    FString BuildError = FBTNodeFactory::BuildTree(Spec, Ctx);
    if (!BuildError.IsEmpty()) return BuildError;

    // 4. Commit: set RootNode (atomic -- only on full success)
    BT->RootNode = Cast<UBTCompositeNode>(Ctx.NodeMap[Spec.Root.Id]);

    // 5. Sync editor graph
    FBTEditorGraphSync::Sync(BT);

    return FString();  // empty = success
}
```

Build is atomic: if any phase fails, `RootNode` is never set.

### Build.cs additions

```csharp
PrivateDependencyModuleNames.AddRange(new string[] {
    "AIModule",
    "GameplayTasks",
    "BehaviorTreeEditor",
});
```

### Public API

```cpp
UCLASS()
class BLUEPRINTGRAPHBUILDER_API UBehaviorTreeBuilderLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
    static FString BuildBehaviorTreeFromJSON(
        UBehaviorTree* BehaviorTree,
        const FString& JsonString
    );
};
```

Returns empty string on success, error description on failure. Follows the Widget builder's `FString` return convention, not the original Blueprint builder's `void` return. The `FString` pattern provides better error reporting to the Python caller.

**Note:** The roadmap spec (`2026-03-18-gameplay-generator-roadmap-design.md`) uses stale param names (`accept_radius`, `BTTask_MoveTo` prefix) in its Phase 3b sketch. This design spec is authoritative.

---

## Python Integration

### ai_generator.py changes

`generate_behavior_tree()` gains a build step between asset creation and save:

1. Create BT asset via factory (unchanged).
2. Assign `blackboard_asset` on BT **before** building nodes.
3. Check if `spec.root` is a dict with a `"type"` key.
4. Check if `BehaviorTreeBuilderLibrary` exists and has `build_behavior_tree_from_json`.
5. Serialize `{"root": spec.root}` to JSON string (with try/except guard).
6. Call `lib.build_behavior_tree_from_json(bt, json_str)`.
7. If error returned, set `success = False`.
8. Save asset.
9. Return structured result with `graph_built`, `builder_available`, `blackboard_assigned` flags.

**Graceful degradation:** If the C++ plugin is not loaded, the BT asset is still created as an empty shell with the blackboard assigned. `builder_available: false` and `graph_built: false` tell the caller what happened.

### enemy_patrol.py changes

Upgrade `BehaviorTreeSpec.root` to the full JSON schema:

- Add `id` and `name` fields to all nodes.
- Add Blackboard decorator (`IsSet` on TargetActor) to the chase sequence.
- Add Blackboard decorator (`IsNotSet` on TargetActor) to the patrol sequence.
- Use correct param names: `blackboard_key`, `acceptable_radius`, `wait_time`, `random_deviation`.
- Add `graph_json` to the enemy Character BP for DetectionSphere overlap logic:
  - OnBeginOverlap: check if overlapping actor is player, set `TargetActor` on blackboard.
  - OnEndOverlap: clear `TargetActor` on blackboard.
- Add initialization logic to AIController BP:
  - OnBeginPlay: set `PatrolLocation` to actor's current location.

Complete upgraded `BehaviorTreeSpec.root` for enemy_patrol:

```python
root={
    "id": "root_selector",
    "type": "Selector",
    "name": "EnemyBehavior",
    "children": [
        {
            "id": "chase_sequence",
            "type": "Sequence",
            "name": "ChasePlayer",
            "decorators": [
                {
                    "id": "has_target",
                    "type": "Blackboard",
                    "name": "HasTarget",
                    "params": {
                        "blackboard_key": "TargetActor",
                        "condition": "IsSet",
                    },
                },
            ],
            "children": [
                {
                    "id": "move_to_target",
                    "type": "MoveTo",
                    "name": "ChaseTarget",
                    "params": {
                        "blackboard_key": "TargetActor",
                        "acceptable_radius": 100.0,
                    },
                },
            ],
        },
        {
            "id": "patrol_sequence",
            "type": "Sequence",
            "name": "Patrol",
            "decorators": [
                {
                    "id": "no_target",
                    "type": "Blackboard",
                    "name": "NoTarget",
                    "params": {
                        "blackboard_key": "TargetActor",
                        "condition": "IsNotSet",
                    },
                },
            ],
            "children": [
                {
                    "id": "move_to_patrol",
                    "type": "MoveTo",
                    "name": "GoToPatrolPoint",
                    "params": {
                        "blackboard_key": "PatrolLocation",
                        "acceptable_radius": 50.0,
                    },
                },
                {
                    "id": "patrol_wait",
                    "type": "Wait",
                    "name": "WaitAtPoint",
                    "params": {
                        "wait_time": 2.0,
                        "random_deviation": 1.0,
                    },
                },
            ],
        },
    ],
}
```

Node ID convention: `<role>_<action>` (e.g. `chase_sequence`, `move_to_target`). IDs must be unique within the tree.

---

## Behavior Loop (what happens in PIE)

1. Game starts. AIController's BeginPlay sets `PatrolLocation` = enemy's spawn location.
2. BT starts running. No `TargetActor` set, so chase decorator fails, patrol runs.
3. Enemy moves to `PatrolLocation`, waits 2s (+/- 1s random), repeats.
4. Player enters `DetectionSphere`. Character BP overlap event sets `TargetActor` on blackboard.
5. Next BT tick: chase decorator passes, enemy moves toward player.
6. Player exits `DetectionSphere`. Character BP overlap end event clears `TargetActor`.
7. Next BT tick: chase decorator fails, patrol resumes.

---

## Success Criteria

### Offline (no UE4 needed)

1. All Python tests pass (`test_mechanics.py` with updated BT root assertions).
2. `npm run build` -- no TypeScript errors.
3. `npm test` -- all existing tests pass.

### With UE4 + rebuilt plugin

4. Generated BT asset opens in BT editor showing: Selector -> two Sequences with decorators, MoveTo and Wait tasks with correct params.
5. Enemy patrols in PIE (moves to patrol point, waits, repeats).
6. Enemy chases player when player enters detection sphere.
7. Enemy returns to patrol when player leaves detection sphere.

### Backward compatibility

8. If C++ plugin is not rebuilt, the pipeline still generates BT assets (empty shells) without crashing. `graph_built: false` in response.

---

## What this does NOT include

- No new BT node types beyond the MVP five.
- No BT services (field parsed but ignored).
- No EQS integration.
- No AI Perception component (uses simple sphere overlap instead).
- No animation (Phase 3c).
- No relationship wiring into BTs (future phase).
- No TypeScript tool changes.

---

## Implementation Notes

- When implementation begins, add Behavior Tree Builder to CLAUDE.md Active Workstreams table:
  `| Behavior Tree Builder | ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/ | In progress | docs/superpowers/specs/2026-03-19-behavior-tree-builder-design.md |`
- The old `BehaviorTreeSpec.root` format (using `BTTask_*` prefixed type names and `tasks` key) in `spec_schema.py` comments and `enemy_patrol.py` must be updated to the new schema before the C++ builder can consume it.
