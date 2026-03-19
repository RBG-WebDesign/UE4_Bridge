# Gameplay Generator Roadmap -- Design Spec

Close the gap between "asset generator" and "autonomous gameplay generator" for UE4.27.
The bridge already has a working generation plane (prompt -> spec -> assets). This roadmap
adds the validation and repair planes, deepens the authoring surface, and replaces the
keyword-matching prompt interpreter with one that produces unique, prompt-faithful specs.

## Current State

The bridge has three layers that already work:

- `prompt_to_spec.py` -- converts a text prompt to a `BuildSpec` (keyword matching, hardcoded genre templates)
- `spec_schema.py` -- `BuildSpec` covering Blueprints, Widgets, Materials, Levels, AI (BT/BB/EQS), Audio, Sequencer, Localization, Cook labels, Anim assets
- `promptbrush.py` -- full generation pipeline: spec -> assets -> compile -> manifest

What is missing or shallow:

| Gap | Current state |
|---|---|
| PIE test harness | `acceptance_tests: List[str]` exists in BuildSpec but nothing launches PIE or asserts |
| Runtime telemetry | No capture of logs, AI state, possession, widget visibility after PIE |
| Authoring depth | Timelines absent; BT/EQS are asset stubs with no node graph content; ABP has no generator |
| Incremental repair | Compile loop retries saves but does not parse errors or patch graphs |
| Import pipeline | No handler for importing external meshes/textures/skeletons |
| Packaging validation | Cook labels generated but no cook execution or result validation |
| Source-control writes | No checkout/lock before saving .uasset files |
| Prompt interpreter | Keyword matching with hardcoded templates; does not produce unique specs |

## Three Planes

```
Generation Plane:   prompt -> spec -> assets         (exists, needs depth)
Validation Plane:   PIE -> telemetry -> assertions   (missing)
Repair Plane:       failure analysis -> patch -> recompile  (stub only)
```

All three planes run inside the same bridge architecture: `POST /` -> `router.py` ->
handlers. No new ports, no new listener process, no new URL namespace.

## Architecture

### New files

```
unreal-plugin/Content/Python/mcp_bridge/
  handlers/
    gameplay.py              -- PIE control, telemetry capture (new handler)
  generation/
    pie_harness.py           -- PIE launch, assertion runner
    telemetry_capture.py     -- log scraping, AI state, possession
    repair_engine.py         -- compile error parsing, targeted spec patching
    timeline_generator.py    -- Timeline asset creation and keyframe authoring
    import_pipeline.py       -- mesh/texture/skeleton import with reimport support
    cook_validator.py        -- cook subprocess trigger and log parser
  utils/
    source_control.py        -- checkout, add, lock before .uasset writes

mcp-server/src/tools/
  gameplay.ts                -- TypeScript tool definitions for all gameplay_* commands
```

### Modified files

```
generation/prompt_to_spec.py    -- replace keyword matching with structured interpreter
generation/spec_schema.py       -- add TimelineSpec, PIETestSpec, IntentMap
generation/ai_generator.py      -- BT node graph content via C++ plugin (see Phase 3b)
generation/compile_loop.py      -- wire repair_engine into retry loop
handlers/promptbrush.py         -- add PIE harness phase after asset generation
router.py                       -- register gameplay_* commands
mcp-server/src/index.ts         -- register gameplay tools, add to modifyingCommands if needed
```

### Command namespace

New MCP commands all use `gameplay_` prefix. Each requires a matching TypeScript tool
definition in `mcp-server/src/tools/gameplay.ts` following the same pattern as
`mcp-server/src/tools/blueprints.ts`.

| Command | Handler | Purpose |
|---|---|---|
| `gameplay_pie_start` | gameplay.py | Launch PIE session |
| `gameplay_pie_stop` | gameplay.py | End PIE session |
| `gameplay_telemetry_snapshot` | gameplay.py | Capture current runtime state |
| `gameplay_run_acceptance_tests` | gameplay.py | Run BuildSpec acceptance_tests against live PIE |
| `gameplay_cook_validate` | gameplay.py | Trigger cook subprocess and return parsed errors |
| `gameplay_import_asset` | gameplay.py | Import external file into content browser |

Note: `gameplay_pie_simulate_input` is deferred. UE4.27 Python has no direct API for
injecting input actions into a running PIE `PlayerController` from an external caller.
This will be revisited if a viable workaround (e.g. a C++ plugin exposing an input
injection subsystem) is identified.

## Phased Roadmap

### Phase 1 -- Validation Plane (PIE harness + telemetry)

**What:** Add the ability to launch PIE, capture runtime state via log polling, and
evaluate the `acceptance_tests` list in a BuildSpec against observed outcomes.

**Why first:** Every other gap depends on knowing whether the game actually works.
Compile success is not gameplay success.

**UE4.27 Python API surface:**

PIE control:
- `unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).play_in_editor(in_editor=False)` -- launches PIE in a separate window, not in-editor, which avoids game-thread blocking
- `unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).request_end_play_map()` -- ends PIE
- PIE is asynchronous. After calling `play_in_editor()`, the harness polls the log file
  for the string `"PIE: play in editor start"` (the exact string UE4.27 emits to the
  output log when PIE is ready). Poll interval: 0.5s, max wait: 30s, implemented via
  `register_slate_post_tick_callback` (the same mechanism the HTTP listener uses for
  game-thread marshaling). If the marker is not found within 30s, `wait_for_pie_ready`
  returns False and `run_assertions` fails all predicates with `observed: "PIE timeout"`.

Log capture:
- UE4.27 Python exposes `unreal.PythonLogOutputDevice` or the `unreal.log` system does
  not provide a subscription API. Instead, log scraping reads the current session log file
  directly from `unreal.Paths.project_log_dir() / ProjectName.log`. A cursor position is
  stored per snapshot so only new lines since the last snapshot are returned.

Runtime state:
- `unreal.EditorLevelLibrary.get_all_level_actors()` -- iterate actors to find pawns and
  AI controllers in the current level. Does not work during PIE (editor actors are separate
  from PIE actors). During PIE, use `unreal.GameplayStatics.get_all_actors_of_class()`
  called on the PIE world. Getting the PIE world: `unreal.EditorLevelLibrary.get_editor_world()`
  returns the PIE world when PIE is active.
- `unreal.GameplayStatics.get_player_controller(world, 0).get_controlled_pawn()` -- pawn possession check
- Widget visibility: `unreal.WidgetBlueprintLibrary` does not expose a runtime widget
  stack inspector. The `widget_visible` predicate is implemented by checking the output
  log for a `[WidgetVisible:WBP_HUD]` log line, which the generated Widget Blueprint must
  emit via a `PrintString` node on its Construct event. This is a convention the generation
  pipeline follows: every generated Widget Blueprint emits `[WidgetVisible:<name>]` on Construct.

**New files:**
- `generation/pie_harness.py` -- `launch_pie()`, `stop_pie()`, `wait_for_pie_ready(timeout_s=30) -> bool`, `run_assertions(tests: List[str]) -> List[AssertionResult]`
- `generation/telemetry_capture.py` -- `snapshot() -> TelemetryFrame` with fields: `log_lines_since_last` (new lines from log file), `possessed_pawn_class` (str or None), `ai_controller_states` (dict of actor name -> state), `fps` (float)
- `handlers/gameplay.py` -- wraps harness and capture behind MCP commands

**Predicate format:** `acceptance_tests: List[str]` entries are colon-delimited strings:

```
"pawn_possessed:BP_Character"       -- possessed pawn class name contains BP_Character
"widget_visible:WBP_HUD"           -- log contains [WidgetVisible:WBP_HUD] since PIE start
"log_contains:GameStarted"         -- log contains literal string GameStarted
"ai_state:BP_Enemy:Patrol"         -- AI controller on actor named BP_Enemy* is in state Patrol
"survive:5"                        -- PIE ran for 5 seconds without a Fatal: log line
```

The `survive:N` predicate (replaces `no_crash:5s`) waits N seconds then checks that no
`Fatal:` or `Error: (Assertion failed)` line appeared in the log. If the editor crashes,
the PIE session ends and the HTTP listener stops responding; `run_assertions` returns a
timeout failure for all remaining predicates.

**TypeScript:** `mcp-server/src/tools/gameplay.ts` defines all 6 gameplay commands
with Zod schemas following the same pattern as `blueprints.ts`. Minimum schema fields:

| Command | Required params | Optional params |
|---|---|---|
| `gameplay_pie_start` | (none) | `level_path: string` |
| `gameplay_pie_stop` | (none) | (none) |
| `gameplay_telemetry_snapshot` | (none) | (none) |
| `gameplay_run_acceptance_tests` | `tests: string[]` | `timeout_seconds: number` |
| `gameplay_cook_validate` | `map_path: string` | `platform: string` |
| `gameplay_import_asset` | `source_path: string`, `content_path: string` | `options: object` |

`gameplay_cook_validate` resolves the `UE4Editor-cmd.exe` path at runtime via
`unreal.Paths.engine_dir()` + `"Binaries/Win64/UE4Editor-Cmd.exe"` inside the Python
handler -- it is not a caller-supplied parameter.

**Success criteria:**
- `gameplay_pie_start` launches PIE and returns `{success: true}` once the PIE world is ready
- `gameplay_run_acceptance_tests` returns a list of `{predicate, passed, observed}` objects
- A PromptBrush run generating a horror game can assert `log_contains:TriggerFired` and receive a real pass/fail

**Prerequisites:** None.

---

### Phase 2 -- Prompt Interpreter (unique specs)

**What:** Replace `prompt_to_spec.py`'s keyword matching and hardcoded genre templates
with a structured interpreter that reads the prompt and produces a unique `BuildSpec`
reflecting what was actually asked.

**Why second:** The generation plane is only as good as the spec it receives. "Make a
horror game" currently always produces the same Blueprint list regardless of what the
prompt actually describes.

**Approach:** Two-pass strategy:

1. **Intent extraction** -- parse the prompt for: genre, named actors (e.g. "a ghost",
   "a coin", "a door"), named mechanics (e.g. "collects", "opens when", "must hide from"),
   win/lose conditions, named maps, named UI screens, named audio cues, named sequences.
   Produces an `IntentMap`.

2. **Spec assembly** -- build `BuildSpec` from `IntentMap` using a mechanics registry.
   Each mechanic in the registry is a small Python file that exports a `fragment(intent: IntentMap) -> BuildSpecFragment`.
   `BuildSpecFragment` is a partial `BuildSpec` (same dataclass, all fields optional).
   Fragments are merged into the final `BuildSpec` by concatenating lists and merging dicts.

`IntentMap` fields:
```python
@dataclass
class IntentMap:
    genre: str                        # detected or "generic"
    actors: List[str]                 # named entities from prompt ("coin", "door", "ghost")
    mechanics: List[str]              # detected verb phrases ("collect", "hide", "open_when")
    win_condition: Optional[str]      # "all_coins_collected", "reach_exit", etc.
    lose_condition: Optional[str]     # "caught_by_enemy", "timer_expired", etc.
    map_names: List[str]              # named levels ("dungeon", "lobby")
    ui_screens: List[str]             # named UI ("hud", "game_over", "main_menu")
    audio_cues: List[str]             # named sounds ("footstep", "coin_collect")
    raw_prompt: str                   # original prompt text
```

This is deterministic and runs inside UE4 with no external API calls. The intelligence
is in the mechanics registry: the richer the registry, the more diverse the output.

Starter mechanics registry (minimum viable):
- `mechanics/player_movement.py` -- Character, PlayerController, input mappings
- `mechanics/collect_item.py` -- pickup actor, counter variable, win trigger
- `mechanics/door_trigger.py` -- door Blueprint with Timeline lerp open
- `mechanics/enemy_patrol.py` -- AI enemy with BT Sequence/MoveTo/Wait
- `mechanics/hide_from_enemy.py` -- AI perception, stealth variable, lose trigger
- `mechanics/main_menu.py` -- WBP_MainMenu with Play/Quit buttons
- `mechanics/game_over.py` -- WBP_GameOver with score display and retry

**New files:**
- `generation/intent_extractor.py` -- `extract_intent(prompt: str) -> IntentMap`
- `generation/spec_assembler.py` -- `assemble(intent: IntentMap) -> BuildSpec`
- `generation/mechanics/__init__.py`
- `generation/mechanics/player_movement.py`
- `generation/mechanics/collect_item.py`
- `generation/mechanics/door_trigger.py`
- `generation/mechanics/enemy_patrol.py`
- `generation/mechanics/hide_from_enemy.py`
- `generation/mechanics/main_menu.py`
- `generation/mechanics/game_over.py`
- `generation/spec_schema.py` -- add `IntentMap`, `BuildSpecFragment` dataclasses

**Modified files:**
- `generation/prompt_to_spec.py` -- delegates to `extract_intent` + `assemble`

**Success criteria:**
- Prompt "player collects coins and a door opens when all coins are collected" produces a `BuildSpec` containing `BP_Coin`, `BP_Door`, and `BP_GameMode` with a coin counter -- but not `BP_Enemy`
- Prompt "player must hide from a monster" produces `BP_Enemy` with a BT, `BP_AIController`, and `BP_PlayerCharacter` with a stealth variable -- but not `BP_Coin` or `BP_Door`
- Neither output contains hardcoded genre template names from the old `prompt_to_spec.py`

**Prerequisites:** None (parallel to Phase 1).

---

### Phase 3a -- Timelines

**What:** Add `TimelineSpec` to `spec_schema.py` and `timeline_generator.py` that creates
`UCurveFloat` / `UCurveVector` assets and attaches them to Blueprint event graphs as
`CallFunction:AddTimeline` nodes via the existing `BlueprintGraphBuilderLibrary` C++ plugin.

**Why timelines:** Timelines are the most common way to drive smooth movement, fade
effects, and timed door-open sequences. Generated Blueprints that need time-based behavior
currently have no mechanism.

**Approach:** Timelines in UE4.27 cannot be added to a Blueprint's SimpleConstructionScript
from Python -- the SCS node API for TimelineComponent is not exposed. Instead, the
approach is:
1. Create a `UCurveFloat` asset for each track via `AssetToolsHelpers`
2. Emit a `TimelineNode` entry in the Blueprint's `graph_json` that the
   `BlueprintGraphBuilderLibrary` (existing C++ plugin, pass 12) processes into a
   `UK2Node_Timeline` graph node wired to the curve asset
3. Pass 12 of the C++ plugin must be added to implement `UK2Node_Timeline` insertion

`TimelineSpec` fields:
```python
@dataclass
class TimelineSpec:
    name: str                          # e.g. "DoorOpen"
    content_path: str                  # where to store the CurveFloat asset
    duration: float                    # seconds
    tracks: List[Dict[str, Any]]       # [{"name", "type": "float|vector", "keyframes": [{"time", "value"}]}]
    auto_play: bool = False
    loop: bool = False
```

**New files:**
- `generation/timeline_generator.py` -- `generate_timeline(spec: TimelineSpec)` creates CurveFloat assets and returns graph_json fragment for use by BlueprintGraphBuilderLibrary
- `ue4-plugin/BlueprintGraphBuilder/Private/Pass12_Timeline.cpp` -- C++ pass 12 implementing `UK2Node_Timeline` insertion

**Modified files:**
- `generation/spec_schema.py` -- add `TimelineSpec`, add `timelines: List[TimelineSpec]` to `BuildSpec`
- `generation/blueprint_generator.py` -- call `timeline_generator` before graph build

**Success criteria:**
- `UK2Node_Timeline` node is present in the door Blueprint's event graph (verifiable in the Blueprint editor without running PIE)
- `CurveFloat` asset exists at the specified `content_path`
- Bonus (requires Phase 1): door rotates over 1 second in PIE when trigger fires

**Prerequisites:** None. Phase 1 is recommended for full runtime validation of the success criteria but not required to implement or merge this phase.

---

### Phase 3b -- Behavior Tree Node Graphs

**What:** Add node graph content to generated Behavior Trees. Currently `generate_behavior_tree()`
creates a BT asset shell with a Blackboard assigned but no composite/task nodes.

**Why:** A BT with no tree is a non-functional asset. Generated enemies have AI controllers
that reference BTs with empty graphs, so enemies stand still.

**API constraint:** `UBehaviorTreeGraphNode` (the graph editor node type) is in the
`BehaviorTreeEditor` module and is not exposed to UE4.27 Python. The same constraint that
required a C++ plugin for Blueprint graph authoring applies here.

**Approach:** Add a `BehaviorTreeBuilderLibrary` C++ class to the existing
`BlueprintGraphBuilder` plugin (new subdirectory `Private/BehaviorTreeBuilder/`).
Exposes one function to Python:
```cpp
static bool BuildBehaviorTreeFromJSON(
    UBehaviorTree* BehaviorTree,
    const FString& JsonString,
    FString& OutError
);
```

The JSON schema mirrors the existing `BehaviorTreeSpec.root` dict:
```json
{
  "type": "Sequence",
  "children": [
    {"type": "BTTask_MoveTo", "params": {"accept_radius": 50.0}},
    {"type": "BTTask_Wait", "params": {"wait_time": 2.0}}
  ]
}
```

**New files:**
- `ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BehaviorTreeBuilderLibrary.h`
- `ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BehaviorTreeBuilderLibrary.cpp`

**Modified files:**
- `generation/ai_generator.py` -- after creating BT asset shell, call `BehaviorTreeBuilderLibrary.BuildBehaviorTreeFromJSON`
- `ue4-plugin/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs` -- add `AIModule`, `BehaviorTreeEditor` dependencies

**Success criteria:** A generated enemy Blueprint's BT asset contains a Selector with a
Sequence -> BTTask_MoveTo -> BTTask_Wait subgraph visible in the BT editor. The enemy
moves to a patrol point and waits in PIE.

**Prerequisites:** None.

---

### Phase 3c -- Anim Blueprint State Machines

**What:** `AnimBlueprintSpec` exists in `spec_schema.py` but no generator creates ABP
assets or wires state machine transitions.

**Why:** Characters with no AnimBlueprint use a default T-pose in PIE. Generated games
with a character need at least Idle/Walk/Run to feel playable.

**API constraint:** `UAnimationStateMachineGraph` is in the `AnimGraph` module and is
not exposed to UE4.27 Python. Same constraint as BT graphs -- requires C++ plugin.

**Approach:** Add an `AnimBlueprintBuilderLibrary` C++ class to the existing plugin
(new subdirectory `Private/AnimBuilder/`). Exposes:
```cpp
static bool BuildAnimBlueprintFromJSON(
    UAnimBlueprint* AnimBlueprint,
    const FString& JsonString,
    FString& OutError
);
```

JSON schema mirrors `AnimBlueprintSpec.state_machines`:
```json
{
  "state_machines": [{
    "name": "LocomotionSM",
    "states": [
      {"name": "Idle", "anim_sequence_path": "/Game/Anims/Idle"},
      {"name": "Walk", "anim_sequence_path": "/Game/Anims/Walk"}
    ],
    "transitions": [
      {"from": "Idle", "to": "Walk", "condition": "Speed > 10"}
    ]
  }]
}
```

**New files:**
- `generation/anim_blueprint_generator.py` -- `generate_anim_blueprint(spec: AnimBlueprintSpec)`
- `ue4-plugin/BlueprintGraphBuilder/Private/AnimBuilder/AnimBlueprintBuilderLibrary.h`
- `ue4-plugin/BlueprintGraphBuilder/Private/AnimBuilder/AnimBlueprintBuilderLibrary.cpp`

**Modified files:**
- `generation/spec_schema.py` -- `AnimBlueprintSpec` already exists, no schema changes needed
- `handlers/promptbrush.py` -- add `generate_all_anim_blueprints` call in pipeline
- `ue4-plugin/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs` -- add `AnimGraph`, `AnimGraphRuntime` dependencies

**Success criteria:** A generated character has an ABP with an Idle/Walk state machine
visible in the Anim Blueprint editor. The character plays the Idle animation in PIE and
transitions to Walk when `Speed > 10`.

**Prerequisites:** None.

---

### Phase 4 -- Incremental Repair Engine

**What:** When Blueprint compilation fails, parse the error, identify which node or
variable is broken, patch the spec fragment that produced it, and recompile -- without
regenerating the whole BuildSpec.

**Why:** The current compile loop retries the same `save_asset()` call up to 3 times.
If the graph has a broken node reference, all three attempts fail identically.
Real repair requires reading the error, understanding which graph fragment caused it,
and issuing a targeted fix.

**Error source:** The existing `compile_loop.py` catches exceptions from `save_asset()`.
Blueprint compile errors also appear in the editor output log as `LogKismet: Error:` lines.
`repair_engine.py` reads compile errors from two sources:
1. The exception string from `save_asset()` (immediate, may be partial)
2. New `LogKismet: Error:` lines from the log file (via the same log-file cursor mechanism
   as Phase 1 telemetry capture) scraped after the failed save

**Repair strategies by error class:**

| Error pattern | Repair action |
|---|---|
| `Cannot find function 'X'` | Remove the node calling X from `graph_json` |
| `Variable 'X' not found` | Add variable X with inferred type to `BlueprintSpec.variables` |
| `Pin type mismatch: A to B` | Insert a type-conversion node between the mismatched pins |
| `Circular dependency` | Remove the cross-reference node from the dependent Blueprint |
| `Missing parent class` | Set `parent_class` to `Actor` in `BlueprintSpec` |

**New files:**
- `generation/repair_engine.py` -- `parse_compile_errors(log_lines: List[str], exception: str) -> List[RepairAction]`, `apply_repair(spec: BuildSpec, bp_name: str, action: RepairAction) -> BuildSpec`

**Modified files:**
- `generation/compile_loop.py` -- on failure, scrape log for `LogKismet: Error:` lines, call `repair_engine`, then retry

**Success criteria:**
- A Blueprint with a broken function call reference (`Cannot find function`) compiles after one repair pass
- A Blueprint with a missing variable compiles after the variable is added
- A Blueprint with a pin type mismatch compiles after a conversion node is inserted
- All three cases verified without human input

**Prerequisites:** Phase 1's `telemetry_capture.py` log-file cursor utility is reused here
to read `LogKismet: Error:` lines. Only that file-reading utility is needed, not the full
PIE harness. If implementing Phase 4 before Phase 1, the log-cursor code can be written
directly in `repair_engine.py` and later extracted into `telemetry_capture.py` when
Phase 1 is built.

---

### Phase 5 -- Import Pipeline

**What:** Add the ability to import external files (FBX meshes, PNG textures,
WAV audio, skeletal meshes with skeleton assignment) into the content browser,
handle reimport when the source file changes, and normalize imported assets
(auto-assign materials, fix skeleton references, generate LODs).

**Why:** Generated gameplay that uses only primitive meshes and placeholder materials
will never feel like a real game. The import pipeline is how placeholder content gets
replaced with real assets without breaking Blueprint references.

**UE4.27 Python API surface:**
- `unreal.AssetImportTask` -- configure one import task (source path, destination, options)
- `unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])` -- execute batch
- `unreal.FbxImportUI` -- FBX import options: `import_mesh`, `import_as_skeletal`, `skeleton`, `generate_lod_group`
- `unreal.EditorAssetLibrary.reimport_async(path)` -- reimport from original source
- `unreal.ImportSubsystem` -- register post-import delegate for normalization (assign default material, etc.)

**New files:**
- `generation/import_pipeline.py`:
  - `import_file(source_path: str, content_path: str, options: Dict[str, Any]) -> ImportResult`
  - `reimport_asset(content_path: str) -> ImportResult`
  - `normalize_skeletal_mesh(content_path: str, skeleton_path: str) -> bool`

**Modified files:**
- `router.py` -- register `gameplay_import_asset` -> `gameplay.handle_import_asset`
- `handlers/gameplay.py` -- `handle_import_asset` calls `import_pipeline.import_file`

**Success criteria:** An FBX character mesh imports to a specified content path, receives
auto-assigned materials via post-import hook, and gets its skeleton assigned to an existing
`USkeleton` asset -- all from one `gameplay_import_asset` call, no dialog boxes, no
human clicks.

**Prerequisites:** None (parallel to all other phases).

---

### Phase 6 -- Packaging Validation

**What:** Trigger a cook for generated content and parse the cook log to verify all
generated assets cooked cleanly, no missing references, no stripped content.

**Why:** Assets that compile in-editor can fail to cook: unresolved soft references,
editor-only code in runtime Blueprints, missing redirectors, or AssetManager rules that
exclude generated content from the cook.

**UE4.27 approach -- editor commandlet, not RunUAT from inside the editor:**
Running `RunUAT.bat BuildCookRun` from inside the editor process is blocked by file locks
(the editor holds exclusive locks on .uasset files). Instead, the cook is triggered via
the editor's `DerivedDataCache` commandlet in a separate process that the editor spawns
and waits on:

```
UE4Editor-cmd.exe <ProjectFile> -run=Cook -TargetPlatform=WindowsNoEditor
  -fileopenlog -stdout -unattended -NoLogTimes -map=<MapPath>
```

This is a subprocess spawned by `cook_validator.py` using `subprocess.Popen`. The editor
process that spawns it must release its lock by having already saved all assets before
the cook subprocess starts. The cook subprocess reads cooked assets from the saved
versions, not from the live editor memory.

The `UE4Editor-Cmd.exe` path is resolved at runtime inside `cook_validator.py` via:
```python
unreal.Paths.engine_dir() + "Binaries/Win64/UE4Editor-Cmd.exe"
```
It is not a caller-supplied parameter. The project file path is resolved via
`unreal.Paths.get_project_file_path()`.

**New files:**
- `generation/cook_validator.py`:
  - `run_cook(map_path: str) -> CookResult`
  - `parse_cook_log(log: str) -> List[CookError]`

`CookError` fields: `asset_path`, `error_type` (`missing_ref`, `editor_only`, `stripped`), `message`

**Modified files:**
- `router.py` -- register `gameplay_cook_validate`
- `handlers/gameplay.py` -- `handle_cook_validate` calls `cook_validator.run_cook`
- `handlers/promptbrush.py` -- add optional cook validation phase after manifest write

**Success criteria:** `gameplay_cook_validate` returns either a list of `CookError`
objects identifying missing references, or `{success: true, errors: []}` confirming a
clean cook. The cook subprocess exits and returns results within 5 minutes for a
standard generated level.

**Prerequisites:** Phase 1 (proves game works in PIE before investing cook time),
Phase 5 (real assets are in place before cook).

---

### Phase 7 -- Source-Control Aware Writes

**What:** Before saving or overwriting any `.uasset` file, check it out from source
control, and after generation mark new files for add. If checkout fails because the
file is locked by another user, report the lock owner instead of silently overwriting.

**Why:** Silent overwrite of a checked-out `.uasset` causes binary merge conflicts in
Perforce. Git LFS requires explicit `git add` for new binary assets.

**UE4.27 Python API surface:**
- `unreal.SourceControl.get_provider()` -- returns the active provider (Perforce, Git, None)
- `unreal.SourceControl.get_file_states([paths])` -- returns `SourceControlState` per path
- `unreal.SourceControl.check_out_files([paths])` -- checkout before write
- `unreal.SourceControl.mark_files_for_add([paths])` -- add new files

**Behavior when no source control is configured:** `get_provider()` returns `None` or an
inactive provider. In this case `checkout_before_write` returns `True` immediately and
proceeds without error. This is the expected behavior for solo development.

**New files:**
- `utils/source_control.py`:
  - `checkout_before_write(path: str) -> bool` -- returns True if safe to write (checked out or no SC)
  - `mark_new_for_add(path: str) -> bool`
  - `get_lock_owner(path: str) -> Optional[str]` -- returns username if locked by another user

**Modified files:** Nine generator files that call `unreal.EditorAssetLibrary.save_asset()`:
`blueprint_generator.py`, `widget_generator.py`, `asset_generator.py`, `level_generator.py`,
`audio_generator.py`, `sequence_generator.py`, `localization_generator.py`,
`cook_generator.py`, `ai_generator.py`.

Each `save_asset(path)` call is preceded by `source_control.checkout_before_write(path)`.
If `checkout_before_write` returns `False` (locked by another user), the generator
skips the asset and records it as a skipped result with `lock_owner` in the error field.

**Success criteria:**
- Generating a Blueprint that exists in a Perforce workspace checks it out before saving
- A new Blueprint is marked for add after creation
- A file locked by another user returns `{success: false, error: "Locked by: username"}` instead of failing silently or overwriting
- When no source control provider is configured, all writes proceed without error

**Prerequisites:** None. Lowest urgency -- only relevant in team environments.

---

## Dependency Graph

```
Phase 1 (PIE harness)     -----> Phase 4 (log-scrape mechanism reused for compile errors)
Phase 1 (PIE harness)     -----> Phase 6 (proves PIE works before cook investment)
Phase 5 (import pipeline) -----> Phase 6 (real assets in place before cook)
Phase 2 (prompt interp)   independent
Phase 3a (timelines)      independent
Phase 3b (BT graphs)      independent (C++ plugin work)
Phase 3c (anim BP)        independent (C++ plugin work)
Phase 7 (source control)  independent
```

Recommended build order:
1. Phase 1 (PIE harness)
2. Phase 2 + Phase 3a/3b/3c in parallel (no dependencies between them)
3. Phase 4 (after Phase 1)
4. Phase 5 (any time)
5. Phase 6 (after Phase 1 and Phase 5)
6. Phase 7 (any time)

## What This Does Not Cover

- **Multiplayer / replication** -- UE4.27 Python does not expose replication graph authoring. Replicated variables and RPCs require C++ or manual Blueprint editing.
- **Animation retargeting** -- Skeleton retargeting is editor UI only, no Python API.
- **Packaging to platforms other than Windows** -- Cross-compilation toolchains are outside the bridge's scope.
- **Runtime crashes inside PIE that kill the editor process** -- The PIE harness returns a timeout failure for all remaining predicates. A crash watchdog (external process monitor) is out of scope.
- **Input simulation during PIE** -- No Python API exists for injecting input actions into a running PIE PlayerController. Deferred pending a C++ input injection plugin.
- **Content quality** -- The bridge generates structurally correct assets. Whether the game is fun, balanced, or visually polished is outside the scope of automation.
