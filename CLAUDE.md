# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context
This is a local tooling bridge that lets Claude Code control UE4.27's editor through MCP.
Three components: TypeScript MCP server, Python listener inside UE4, and .mcp.json config.
The MCP server talks stdio to Claude Code and HTTP to the Python listener.
The Python listener executes commands against UE4's Python API on the game thread.

## Build and Dev Commands
```bash
npm install              # install all dependencies (workspace root)
npm run build            # compile TypeScript (mcp-server/src -> mcp-server/dist)
npm run dev              # watch mode -- recompiles on file changes
npm test                 # run unit tests (mock server, no UE4 needed)
npm run test:integration # run integration tests (requires UE4 running with listener)
```

Run a single test file directly:
```bash
npx tsx mcp-server/tests/actor-tools.test.ts
```

No linter is configured. No external test runner (no jest/mocha) -- tests use `tsx` to run TypeScript directly with a custom assert pattern. Unit tests live in `mcp-server/tests/` and use a mock HTTP server (`mock-server.ts`) that simulates UE4 responses -- no UE4 needed. Integration tests live in `mcp-server/tests/integration/` and hit the real UE4 listener.

`npm test` chains three unit test files in sequence: `actor-tools.test.ts`, `level-viewport-tools.test.ts`, `material-blueprint-tools.test.ts`. If one fails, later files do not run.

The MCP server entry point is `mcp-server/dist/index.js` (ESM). Claude Code discovers it via `.mcp.json`. The workspace root `package.json` delegates all scripts to the `mcp-server` workspace.

### Prerequisites
- UE4.27 with the Python Editor Script Plugin enabled
- Node.js 18+

## Architecture

```
Claude Code --stdio--> MCP Server (TypeScript) --HTTP POST /:8080--> Python Listener (inside UE4) --> unreal module
                                                                                                   --> BlueprintGraphBuilder (C++ plugin, via Python bindings)

ShaderWeave (web app, future) --HTTP /shaderweave/v1/*:8080--> Python Listener (same) --> material custom expression ops
```

### MCP Server (`mcp-server/src/`)
- `index.ts` -- entry point, registers all tools, starts stdio transport
- `unreal-client.ts` -- the sole HTTP client that talks to UE4 (localhost:8080, 60s timeout)
- `types.ts` -- shared `ToolDefinition` interface (name, Zod schema, handler)
- `history.ts` -- undo/redo/checkpoint tracking
- `validation.ts` -- shared validation helpers
- `tools/` -- one file per tool group (actors, blueprints, level, materials, operations, project, system, viewport). Each exports a `create*Tools(client)` factory returning `ToolDefinition[]`.

`index.ts` collects all tool arrays, builds a lookup map, and tracks which commands are "modifying" (recorded in history for undo). Modifying commands: actor_spawn, actor_modify, actor_delete, actor_duplicate, actor_organize, actor_snap_to_socket, batch_spawn, material_create, material_apply, blueprint_create, blueprint_compile, blueprint_build_from_json, level_save.

### Python Listener (`unreal-plugin/Content/Python/mcp_bridge/`)
- `listener.py` -- HTTP server on background thread, queues commands to game thread via `register_slate_post_tick_callback`
- `router.py` -- dispatches commands to handlers
- `handlers/` -- mirrors the MCP tool groups (actors, blueprints, level, materials, project, system, viewport)
- `utils/` -- serialization, transactions (UE4 undo wrappers), validation

Auto-started by `unreal-plugin/Content/Python/startup.py` when UE4 loads.

### Threading Constraint
UE4's Python environment runs on the game thread. The HTTP server runs on a background thread. All `unreal` module calls must be marshaled to the game thread through `register_slate_post_tick_callback` in `listener.py`. Never call `unreal.*` from the HTTP handler directly.

### HTTP Protocol
The MCP server POSTs JSON to `http://localhost:8080/`:
```json
{"command": "actor_spawn", "params": {"type": "StaticMeshActor", "name": "MyActor"}}
```
The listener always responds with:
```json
{"success": true, "data": {...}, "error": null}
```
The `UnrealClient.sendCommand()` in `unreal-client.ts` is the only code that makes these HTTP calls. Connection errors and timeouts resolve (not reject) with `{success: false}`.

### BlueprintGraphBuilder C++ Plugin (`ue4-plugin/BlueprintGraphBuilder/`)
A UE4.27 editor plugin (C++) that builds Blueprint event graphs and Widget Blueprints from JSON. Compiled inside a UE4 project (copied to `YourProject/Plugins/`), not by `npm run build`. Contains two subsystems:

**Blueprint Graph Builder** (11 passes complete) -- builds event graphs from JSON. Exposes `UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON` to Python. The Python handler for `blueprint_build_from_json` calls this.

**Widget Blueprint Builder** (design spec complete, implementation not started) -- builds UMG Widget Blueprints from JSON. Lives under `Private/WidgetBuilder/` subdirectory. Exposes `UWidgetBlueprintBuilderLibrary` with `BuildWidgetFromJSON`, `RebuildWidgetFromJSON`, `ValidateWidgetJSON`. Spec: `docs/superpowers/specs/2026-03-18-widget-blueprint-builder-design.md`.

### ShaderWeave Bridge (`unreal-plugin/Content/Python/mcp_bridge/shaderweave/`)
A separate product that shares the UE_Bridge HTTP listener. Pushes HLSL into Material Custom Expression nodes and returns compile feedback. Uses its own URL namespace (`/shaderweave/v1/*`) separate from the existing `POST /` command router. ShaderWeave is its own repo/product -- UE_Bridge only hosts the transport and UE4 execution layer. Spec: `docs/superpowers/specs/2026-03-18-shaderweave-bridge-mvp-design.md`.

### Pattern System (`mcp-server/src/patterns/`)
The `blueprint_build_from_description` tool uses a pattern registry to translate natural language into blueprint graph fragments. Patterns are registered via `registerPattern()` in the registry and merged with auto-wiring logic. Available patterns include `on_begin_play`, `print_string`, `print_float`, `get_actor_location`, `loop_print`, `move_actor_up`. To add a new pattern, create it in the patterns directory and register it in the registry.

### Adding a New Tool
1. Prototype using `python_proxy` first
2. Add a Python handler in `unreal-plugin/Content/Python/mcp_bridge/handlers/`
3. Register the command in `router.py`'s `COMMAND_ROUTES` dict (maps command string to handler function)
4. Add the TypeScript tool definition in the matching `mcp-server/src/tools/` file
5. If the tool modifies editor state, add it to the `modifyingCommands` set in `index.ts`
6. Wrap editor mutations in a UE4 transaction using the `@transactional` decorator from `utils/transactions.py`

## Architecture Rules
- The MCP server never imports or references Unreal modules. It only sends HTTP.
- The Python listener never imports MCP SDK modules. It only receives HTTP.
- Every tool that modifies editor state must be wrapped in a UE4 transaction for undo support.
- Every actor manipulation tool must support the validate parameter.
- The python_proxy tool is the escape hatch. Any new tool should first be prototyped
  through python_proxy before getting its own dedicated handler.
- Viewport operations (camera moves, mode switches, render modes) are NOT transactable.
  Do not wrap them in UE4 transactions.

## Visual Feedback Loop
After any spatial operation (actor_spawn, actor_modify, actor_duplicate, batch_spawn,
actor_snap_to_socket), use viewport_focus on the affected actor followed by
viewport_screenshot to visually verify the result. For multi-actor operations, use
viewport_fit followed by viewport_screenshot for an overview. This visual feedback
loop is the default behavior, not an optional extra.

## Code Standards
- TypeScript: strict mode, explicit types, no `any`
- Python: type hints on all function signatures, docstrings on all handlers
- All tool handlers must return a consistent JSON shape: `{success: bool, data: any, error?: string}`
- No em dashes in comments or documentation
- No academic filler language (delve, explore, leverage, robust, utilize)
- Write documentation like you're explaining to a programmer, not selling to a VP

## Active Workstreams
Multiple agents may work on this repo concurrently. Each workstream has its own spec and plan docs.

| Workstream | Location | Status | Spec |
|---|---|---|---|
| Blueprint Graph Builder | `ue4-plugin/BlueprintGraphBuilder/` | 11 passes complete | `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-design.md` |
| Widget Blueprint Builder | `ue4-plugin/BlueprintGraphBuilder/Private/WidgetBuilder/` | Design complete, Pass 1 planned | `docs/superpowers/specs/2026-03-18-widget-blueprint-builder-design.md` |
| ShaderWeave Bridge | `unreal-plugin/Content/Python/mcp_bridge/shaderweave/` | Design complete | `docs/superpowers/specs/2026-03-18-shaderweave-bridge-mvp-design.md` |
| Behavior Tree Builder | `ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/` | In progress | `docs/superpowers/specs/2026-03-19-behavior-tree-builder-design.md` |

ShaderWeave is a separate product that shares the UE_Bridge listener. It uses `/shaderweave/v1/*` URL paths, not the `POST /` command router. Do not mix ShaderWeave handlers into `handlers/` or ShaderWeave routes into `router.py`. Note: `listener.py` requires minimal path-routing changes for ShaderWeave (see ShaderWeave spec for details).

## File Ownership
- `mcp-server/` is TypeScript only
- `unreal-plugin/` is Python only
- `ue4-plugin/` is C++ only (UE4 plugin, compiled by Unreal Build Tool, not npm)
- `docs/` is Markdown only
- These boundaries are hard. No cross-contamination.
