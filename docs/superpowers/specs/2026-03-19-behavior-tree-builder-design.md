# Phase 3b: Behavior Tree Node Graph Builder -- Design Spec

**Date:** 2026-03-19
**Status:** Implementation complete (expanded beyond MVP, 27 node types)
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
| `BlueprintGraphBuilder.Build.cs` | Add `AIModule`, `GameplayTasks` dependencies; add `BehaviorTreeEditor` as editor-only dependency |
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
  "type": "Selector|Sequence|SimpleParallel|MoveTo|Wait|WaitBlackboardTime|RotateToFaceBBEntry|PlayAnimation|MakeNoise|RunBehavior|PlaySound|FinishWithResult|SetTagCooldown|Blackboard|ForceSuccess|Loop|TimeLimit|Cooldown|CompareBBEntries|IsAtLocation|DoesPathExist|TagCooldown|ConditionalLoop|KeepInCone|IsBBEntryOfClass|DefaultFocus|RunEQS",
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
- `services` -- array of service nodes attached to this composite. Services can only be on composite nodes. Validated against the service type registry.

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
        "services": [
          {
            "id": "focus_target",
            "type": "DefaultFocus",
            "name": "FocusOnTarget",
            "params": {
              "blackboard_key": "TargetActor"
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

### Supported node types

| JSON type | UE4 class | Category |
|---|---|---|
| `Selector` | `UBTComposite_Selector` | Composite |
| `Sequence` | `UBTComposite_Sequence` | Composite |
| `SimpleParallel` | `UBTComposite_SimpleParallel` | Composite |
| `MoveTo` | `UBTTask_MoveTo` | Task |
| `Wait` | `UBTTask_Wait` | Task |
| `WaitBlackboardTime` | `UBTTask_WaitBlackboardTime` | Task |
| `RotateToFaceBBEntry` | `UBTTask_RotateToFaceBBEntry` | Task |
| `PlayAnimation` | `UBTTask_PlayAnimation` | Task |
| `MakeNoise` | `UBTTask_MakeNoise` | Task |
| `RunBehavior` | `UBTTask_RunBehavior` | Task |
| `PlaySound` | `UBTTask_PlaySound` | Task |
| `FinishWithResult` | `UBTTask_FinishWithResult` | Task |
| `SetTagCooldown` | `UBTTask_SetTagCooldown` | Task |
| `Blackboard` | `UBTDecorator_Blackboard` | Decorator |
| `ForceSuccess` | `UBTDecorator_ForceSuccess` | Decorator |
| `Loop` | `UBTDecorator_Loop` | Decorator |
| `TimeLimit` | `UBTDecorator_TimeLimit` | Decorator |
| `Cooldown` | `UBTDecorator_Cooldown` | Decorator |
| `CompareBBEntries` | `UBTDecorator_CompareBBEntries` | Decorator |
| `IsAtLocation` | `UBTDecorator_IsAtLocation` | Decorator |
| `DoesPathExist` | `UBTDecorator_DoesPathExist` | Decorator |
| `TagCooldown` | `UBTDecorator_TagCooldown` | Decorator |
| `ConditionalLoop` | `UBTDecorator_ConditionalLoop` | Decorator |
| `KeepInCone` | `UBTDecorator_KeepInCone` | Decorator |
| `IsBBEntryOfClass` | `UBTDecorator_IsBBEntryOfClass` | Decorator |
| `DefaultFocus` | `UBTService_DefaultFocus` | Service |
| `RunEQS` | `UBTService_RunEQS` | Service |

### Parameter definitions

**MoveTo:**
- `blackboard_key` (string) -- BB key (Object or Vector type). Resolved via `ResolveSelectedKey`.
- `acceptable_radius` (float, default 50.0)

**Wait:**
- `wait_time` (float, default 5.0)
- `random_deviation` (float, default 0.0)

**WaitBlackboardTime:**
- `blackboard_key` (string) -- BB key (Float type). Wait duration read from this key.

**RotateToFaceBBEntry:**
- `blackboard_key` (string) -- BB key (Object or Vector type). Rotates to face this target.

**PlayAnimation:**
- `non_blocking` (string, "true"/"false") -- whether animation is non-blocking.
- `looping` (string, "true"/"false") -- whether animation loops.

**MakeNoise:**
- `loudness` (float, default 1.0)

**RunBehavior:**
- No simple params. BehaviorAsset must be set separately via asset loading.

**PlaySound:**
- `sound_cue` (string) -- asset path to USoundCue. Loaded via `StaticLoadObject`.
- `non_blocking` (string, "true"/"false", default "false") -- whether task completes immediately.

**FinishWithResult:**
- `result` (string) -- "Succeeded", "Failed", or "Aborted". Default: "Succeeded". Immediately finishes the BT execution with the given result.

**SetTagCooldown:**
- `cooldown_tag` (string) -- gameplay tag string (e.g. "AI.Attack.Melee").
- `cooldown_duration` (float, default 5.0) -- seconds.
- `add_to_existing` (string, "true"/"false", default "true") -- whether to add to existing cooldown or reset it.

**SimpleParallel:**
- `finish_mode` (string) -- "Immediate" (abort background on main finish) or "Delayed" (wait for background). Default: "Immediate".
- Must have exactly 2 children: first child is the main task, second is background.

**Blackboard decorator:**
- `blackboard_key` (string) -- BB key to check.
- `condition` (string) -- Basic operations: `"IsSet"`, `"IsNotSet"` (for Object/Vector/Name keys). Arithmetic operations: `"Equal"`, `"NotEqual"`, `"Less"`, `"LessOrEqual"`, `"Greater"`, `"GreaterOrEqual"` (for Int/Float keys). Arithmetic conditions on non-numeric keys are validation errors.
- `int_value` (int) -- comparison value for integer arithmetic conditions.
- `float_value` (float) -- comparison value for float arithmetic conditions.

**ForceSuccess:**
- No params. Wraps child and forces success result.

**Loop:**
- `num_loops` (int, default 3)
- `infinite_loop` (string, "true"/"false", default "false")

**TimeLimit:**
- `time_limit` (float, default 5.0)

**Cooldown:**
- `cool_down_time` (float, default 5.0)

**CompareBBEntries:**
- `blackboard_key_a` (string) -- first BB key.
- `blackboard_key_b` (string) -- second BB key.
- `operator` (string) -- "Equal", "NotEqual", "Less", "LessOrEqual", "Greater", "GreaterOrEqual".

**IsAtLocation (decorator):**
- `blackboard_key` (string) -- BB key (Vector type). Location to check against.
- `acceptable_radius` (float, default 100.0) -- distance threshold for "at location".
- `inverse_condition` (string, "true"/"false", default "false") -- invert the check.

**DoesPathExist (decorator):**
- `blackboard_key_a` (string) -- BB key for path start (Object or Vector type).
- `blackboard_key_b` (string) -- BB key for path end (Object or Vector type).
- `path_exists_condition` (string) -- "PathExists" or "PathDoesNotExist". Default: "PathExists".
- `filter_class` (string, optional) -- navigation filter class name.

**TagCooldown (decorator):**
- `cooldown_tag` (string) -- gameplay tag string (e.g. "AI.Attack.Melee").
- `cooldown_duration` (float, default 5.0) -- seconds.
- `add_to_existing` (string, "true"/"false", default "true") -- whether to add to existing cooldown or reset.

**ConditionalLoop (decorator):**
- `blackboard_key` (string) -- BB key to check each iteration.
- `condition` (string) -- "IsSet" or "IsNotSet". Loop continues while condition is true.

**KeepInCone (decorator):**
- `cone_origin` (string) -- BB key (Object or Vector type). The cone apex.
- `observed` (string) -- BB key (Object or Vector type). The target to keep in cone.
- `cone_half_angle` (float, default 45.0) -- half-angle of the cone in degrees.

**IsBBEntryOfClass (decorator):**
- `blackboard_key` (string) -- BB key (Object type) to check.
- `test_class` (string) -- UClass name to test against (e.g. "Character", "Pawn").

**DefaultFocus (service):**
- `blackboard_key` (string) -- BB key (Object or Vector type). Sets AI focus on this target.

**RunEQS (service):**
- `query_template` (string) -- asset path to UEnvQuery. Loaded via `StaticLoadObject`.
- `blackboard_key` (string) -- BB key to write the EQS result into.
- `run_mode` (string) -- "SingleBestItem" or "AllMatching". Default: "SingleBestItem".
- Note: Requires the `EnvironmentQuery` (EQS) module. Registration is conditional on EQS availability.

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
    TArray<FBTNodeSpec> Services;
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

Four separate maps by category:

```cpp
TMap<FString, TSubclassOf<UBTCompositeNode>> CompositeTypes;
TMap<FString, TSubclassOf<UBTTaskNode>> TaskTypes;
TMap<FString, TSubclassOf<UBTDecorator>> DecoratorTypes;
TMap<FString, TSubclassOf<UBTService>> ServiceTypes;
```

Plus:

```cpp
// Default params per type. Applied when param not specified in JSON.
TMap<FString, TMap<FString, FString>> DefaultParams;

// BB key type requirements per param per type.
// "MoveTo" -> {"blackboard_key" -> {"Object", "Vector"}}
TMap<FString, TMap<FString, TSet<FString>>> BBKeyTypeRequirements;
```

The registry also owns param application logic: `ApplyParams(UBTNode*, const TMap<FString, FString>&, UBlackboardData*)`. For any param that sets a `BlackboardKeySelector` (MoveTo's `BlackboardKey`, Blackboard decorator's `BlackboardKey`), `ApplyParams` must call `ResolveSelectedKey(*BlackboardAsset)` after setting `SelectedKeyName`. This binds the selector to the actual blackboard key entry so the node can read/check the key at runtime.

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
8. `condition` enum values must be exactly `"IsSet"` or `"IsNotSet"` (for Blackboard/ConditionalLoop decorators). Arithmetic conditions: `"Equal"`, `"NotEqual"`, `"Less"`, `"LessOrEqual"`, `"Greater"`, `"GreaterOrEqual"` (for Int/Float BB keys only). No fallback.
9. Unknown `type` strings are hard errors.
10. `result` param on FinishWithResult must be one of `"Succeeded"`, `"Failed"`, `"Aborted"`.
11. `path_exists_condition` on DoesPathExist must be `"PathExists"` or `"PathDoesNotExist"`.
12. `run_mode` on RunEQS must be `"SingleBestItem"` or `"AllMatching"`.

### FBTNodeFactory

Two-phase build for safety:

**Phase A -- Create all nodes:**
Recursively walk `FBTBuildSpec`, create node objects via `NewObject<T>(BehaviorTree)` using the exact subclass from registry. Store in `FBTBuildContext::NodeMap` keyed by Id. Apply params via registry. After creating each node, call `Node->InitializeFromAsset(*BehaviorTree)` to bind blackboard key selectors and internal state. Without this call, `BlackboardKeySelector` fields (e.g. MoveTo's target key) won't resolve and nodes will silently fail at runtime.

**Phase B -- Wire nodes:**
Recursively walk spec again, wire children into composites using `FBTCompositeChild` structs:

```cpp
FBTCompositeChild Child;
Child.ChildComposite = Cast<UBTCompositeNode>(ChildNode);  // set if child is composite
Child.ChildTask = Cast<UBTTaskNode>(ChildNode);            // set if child is task
// Attach decorators defined on this child
for (auto* Dec : ChildDecorators)
{
    Child.Decorators.Add(Dec);
}
Composite->Children.Add(Child);
```

Do NOT push nodes directly into `Children` -- the `FBTCompositeChild` wrapper is required for UE4's BT runtime to traverse the tree.

Decorator attachment: Decorators defined on a composite node attach to that composite's execution. Decorators defined on a task node (child of a composite) attach via the composite's `FBTCompositeChild` entry for that child.

### FBTEditorGraphSync

Post-build step. Entire implementation is wrapped in `#if WITH_EDITOR` / `#endif`. The builder does NOT depend on editor graph sync -- this is a strictly post-build, one-way derivation.

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
2. Clear existing editor graph nodes safely:
   ```cpp
   BTGraph->Modify();
   // Remove nodes in reverse to avoid index shifting issues
   for (int32 i = BTGraph->Nodes.Num() - 1; i >= 0; --i)
   {
       BTGraph->RemoveNode(BTGraph->Nodes[i]);
   }
   ```
   Do not just call `Nodes.Reset()` -- use `RemoveNode()` to clean up pins and avoid orphaned references.
3. For each runtime node, create the correct editor graph node subclass:
   ```cpp
   UBTGraphNode* GraphNode = nullptr;
   if (Cast<UBTCompositeNode>(RuntimeNode))
       GraphNode = NewObject<UBTGraphNode_Composite>(BTGraph);
   else if (Cast<UBTTaskNode>(RuntimeNode))
       GraphNode = NewObject<UBTGraphNode_Task>(BTGraph);
   else if (Cast<UBTDecorator>(RuntimeNode))
       GraphNode = NewObject<UBTGraphNode_Decorator>(BTGraph);

   GraphNode->NodeInstance = RuntimeNode;
   BTGraph->AddNode(GraphNode, /*bFromUI=*/false, /*bSelectNewNode=*/false);
   ```
   Using the base `UBTGraphNode` for all node types will cause incorrect rendering or crashes in the BT editor. The editor expects `UBTGraphNode_Composite`, `UBTGraphNode_Task`, and `UBTGraphNode_Decorator` respectively.
4. Connect parent-child pins via `UEdGraphPin::MakeLinkTo()` following the composite's `Children` array order.
5. For decorators, create `UBTGraphNode_Decorator` and attach as sub-nodes of their parent graph node.
6. Finalize the graph:
   ```cpp
   BTGraph->UpdateAsset();
   BT->MarkPackageDirty();
   ```
   `MarkPackageDirty()` ensures the editor knows the asset has changed and will prompt to save.

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
    // IMPORTANT: Do NOT clear BT->RootNode before this point.
    // If rebuilding an existing BT, the old runtime tree stays intact
    // until we have a fully validated replacement ready to swap in.
    BT->RootNode = Cast<UBTCompositeNode>(Ctx.NodeMap[Spec.Root.Id]);

    // 5. Sync editor graph (editor-only, non-fatal)
#if WITH_EDITOR
    FBTEditorGraphSync::Sync(BT);
#endif

    return FString();  // empty = success
}
```

Build is atomic: if any phase fails, `RootNode` is never set. When rebuilding an existing BT, the previous `RootNode` is only overwritten on full success -- a failed rebuild leaves the existing tree intact rather than corrupting it.

### Build.cs additions

```csharp
PrivateDependencyModuleNames.AddRange(new string[] {
    "AIModule",
    "GameplayTasks",
});

if (Target.bBuildEditor)
{
    PrivateDependencyModuleNames.Add("BehaviorTreeEditor");
}
```

`BehaviorTreeEditor` provides `UBehaviorTreeGraph`, `UBTGraphNode_*`, and `UEdGraphSchema_BehaviorTree`. These are editor-only classes. Adding `BehaviorTreeEditor` as an unconditional dependency will break non-editor (packaged) builds. All code that references editor graph classes must be guarded with `#if WITH_EDITOR`.

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
7. If error returned (non-empty string), set `success = False`. The overall result `success` must reflect the builder outcome, not just asset creation: `success = (build_error == "")`.
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

- RunEQS service is conditionally registered (requires EQS module). If EQS is not available, the node type is silently skipped.
- No AI Perception component (uses simple sphere overlap instead).
- No animation montage loading in PlayAnimation (asset must be set externally).
- No sub-BT asset loading in RunBehavior (asset must be set externally).
- No relationship wiring into BTs (future phase).
- No TypeScript tool changes.

---

## Implementation Notes

- When implementation begins, add Behavior Tree Builder to CLAUDE.md Active Workstreams table:
  `| Behavior Tree Builder | ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/ | In progress | docs/superpowers/specs/2026-03-19-behavior-tree-builder-design.md |`
- The old `BehaviorTreeSpec.root` format (using `BTTask_*` prefixed type names and `tasks` key) in `spec_schema.py` comments and `enemy_patrol.py` must be updated to the new schema before the C++ builder can consume it.
