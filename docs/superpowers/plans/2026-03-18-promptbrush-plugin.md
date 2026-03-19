# PromptBrush Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a UE4.27 plugin (PromptBrush) that accepts natural language prompts and generates complete Unreal gameplay systems -- Blueprints, Widgets, C++ classes, data assets, maps, and level content -- with a compile-and-repair loop.

**Architecture:** Two sides: (1) C++ editor module (`PromptBrush`) in the UE project providing a dockable tab with text input + run button, sending prompts to the MCP bridge listener over HTTP; (2) Python generation pipeline in the bridge (`mcp_bridge/handlers/promptbrush.py`) that converts prompts to JSON build specs and drives all existing UE4 builders. The UEBridgeDashboard plugin already compiles and has a tab -- PromptBrush is a separate plugin.

**Tech Stack:** UE4.27, C++ Slate UI, Python bridge handler + generators, BlueprintGraphBuilder C++ API, MCP bridge HTTP protocol, JSON build specs persisted to disk.

---

## File Map

### Python pipeline (d:\UE\UE_Bridge\unreal-plugin\Content\Python\mcp_bridge\)

- `generation/__init__.py` -- package marker
- `generation/spec_schema.py` -- BuildSpec dataclasses
- `generation/prompt_to_spec.py` -- NL -> BuildSpec (keyword + genre templates)
- `generation/blueprint_generator.py` -- drives blueprint_create + BlueprintGraphBuilderLibrary
- `generation/widget_generator.py` -- drives WidgetBlueprintBuilderLibrary
- `generation/asset_generator.py` -- materials, data assets, curves
- `generation/level_generator.py` -- creates maps, places actors
- `generation/cpp_generator.py` -- writes .h/.cpp to disk
- `generation/compile_loop.py` -- Blueprint compile + repair iteration
- `generation/manifest.py` -- writes generation manifest JSON
- `handlers/promptbrush.py` -- prompt_generate / prompt_status / prompt_spec_list handlers
- `router.py` (modify) -- register new commands

### MCP server (d:\UE\UE_Bridge\mcp-server\src\)

- `tools/promptbrush.ts` -- MCP tool definitions
- `index.ts` (modify) -- register new tools

### C++ plugin (d:/Unreal Projects/CodePlayground/Plugins/PromptBrush/)

- `PromptBrush.uplugin`
- `Source/PromptBrush/PromptBrush.Build.cs`
- `Source/PromptBrush/Public/PromptBrushModule.h`
- `Source/PromptBrush/Private/PromptBrushModule.cpp`
- `Source/PromptBrush/Private/SPromptBrushTab.h`
- `Source/PromptBrush/Private/SPromptBrushTab.cpp`
- `Resources/Icon128.png` (copy from UEBridgeDashboard)

### Agent + skill files

- `agents/01_orchestrator.md` through `agents/10_qa_acceptance_engineer.md`
- `skills/` -- 13 skill procedure files

---

## Task 1: Python pipeline -- spec_schema.py

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/__init__.py`
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py`

- [ ] Write `generation/__init__.py` (package marker)
- [ ] Write `generation/spec_schema.py` with BuildSpec dataclasses
- [ ] Commit

---

## Task 2: prompt_to_spec.py

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/prompt_to_spec.py`

- [ ] Write genre detector and template functions for puzzle_fighter, menu_system, generic
- [ ] Include all widget tree helpers (main menu, HUD, pause, game over, score, timer, combo)
- [ ] Commit

---

## Task 3: blueprint_generator.py

- [ ] Write generate_blueprint() and generate_all_blueprints()
- [ ] Handles parent class resolution, component creation, optional graph JSON, compile, save
- [ ] Commit

---

## Task 4: widget_generator.py

- [ ] Write generate_widget() calling WidgetBlueprintBuilderLibrary.build_widget_from_json()
- [ ] Commit

---

## Task 5: asset_generator.py

- [ ] Write generate_material() using MaterialFactoryNew + MaterialEditingLibrary
- [ ] Write generate_data_asset() for DataAsset, CurveFloat; stub fallback for Enum/Struct/DataTable
- [ ] Commit

---

## Task 6: level_generator.py

- [ ] Write generate_level() using EditorLevelLibrary.new_level(), spawn_actor_from_class()
- [ ] Handle DirectionalLight, PlayerStart, PostProcessVolume, TriggerBox
- [ ] Commit

---

## Task 7: cpp_generator.py

- [ ] Write generate_header() and generate_source() using UCLASS macro patterns
- [ ] Write write_cpp_class() that writes .h/.cpp to Source/Generated/
- [ ] Commit

---

## Task 8: compile_loop.py and manifest.py

- [ ] Write compile_all_blueprints() with retry up to 3 passes
- [ ] Write write_manifest() serializing run data to JSON
- [ ] Commit

---

## Task 9: handlers/promptbrush.py

- [ ] Write handle_prompt_generate() orchestrating all generators
- [ ] Write handle_prompt_status() and handle_prompt_spec_list()
- [ ] Add _write_input_mappings() for DefaultInput.ini
- [ ] Commit

---

## Task 10: blueprints.py -- add bridge handlers

- [ ] Add handle_blueprint_build_from_json() calling BlueprintGraphBuilderLibrary
- [ ] Add handle_widget_build_from_json() calling WidgetBlueprintBuilderLibrary
- [ ] Commit

---

## Task 11: router.py -- wire new commands

- [ ] Add imports for promptbrush handlers and new blueprint handlers
- [ ] Register prompt_generate, prompt_status, prompt_spec_list, blueprint_build_from_json, widget_build_from_json
- [ ] Commit

---

## Task 12: MCP server TypeScript tools

- [ ] Create `mcp-server/src/tools/promptbrush.ts` with 3 tool definitions
- [ ] Register in `mcp-server/src/index.ts`
- [ ] `npm run build` -- must be clean
- [ ] Commit

---

## Task 13: PromptBrush C++ plugin

- [ ] Write all 6 source files in the UE project Plugins/PromptBrush/
- [ ] Copy Icon128.png
- [ ] Build via UBT -- fix any errors
- [ ] Commit

---

## Task 14: Agents and skills

- [ ] Write 10 agent role files
- [ ] Write 13 skill procedure files
- [ ] Commit

---

## Task 15: README and acceptance test

- [ ] Write README_PROMPTBRUSH.md
- [ ] Run prompt_generate dry run via MCP
- [ ] Run full generation
- [ ] Verify assets exist in /Game/Generated/
- [ ] Commit final state

---

## Acceptance Criteria

- [ ] `generation/` package: 9 modules all present
- [ ] `handlers/promptbrush.py` handles 3 commands
- [ ] `router.py` routes all new commands
- [ ] `mcp-server/src/tools/promptbrush.ts` -- TypeScript compiles clean
- [ ] `PromptBrush` C++ plugin compiles in UE4.27
- [ ] `prompt_generate("Make me gameplay like Puzzle Fighter")` creates 5+ BPs, 3+ Widgets, 1 Map, spec JSON, manifest JSON
- [ ] `README_PROMPTBRUSH.md` complete
- [ ] 10 agent files + 13 skill files present
