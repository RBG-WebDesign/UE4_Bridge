---
name: project-context
description: >
  Quick-reference context for the UE_Bridge project. Load this skill when you need
  a fast overview of the project architecture, active workstreams, file ownership
  boundaries, and where to find detailed information.
---

# UE_Bridge Project Context

## Three-Layer Architecture
1. **TypeScript MCP Server** (`mcp-server/src/`) -- tool definitions, Zod schemas, HTTP client
2. **Python Listener** (`unreal-plugin/Content/Python/mcp_bridge/`) -- HTTP server in UE4, game thread dispatch, handlers
3. **C++ Plugin** (`ue4-plugin/BlueprintGraphBuilder/`) -- node graph builders (Blueprint, Widget, BehaviorTree)

## Data Flow
```
Claude Code --stdio--> MCP Server --HTTP POST :8080--> Python Listener --> unreal module / C++ plugin
```

## File Ownership (hard boundaries)
- `mcp-server/` = TypeScript only
- `unreal-plugin/` = Python only
- `ue4-plugin/` = C++ only (compiled by Unreal Build Tool)
- `docs/` = Markdown only

## Active Workstreams
| Workstream | Location | Status |
|---|---|---|
| Blueprint Graph Builder | `ue4-plugin/BlueprintGraphBuilder/` | 11 passes complete |
| Widget Blueprint Builder | `ue4-plugin/.../WidgetBuilder/` | Design complete |
| Behavior Tree Builder | `ue4-plugin/.../BehaviorTreeBuilder/` | Complete (17 node types, services, arithmetic BB conditions) |
| ShaderWeave Bridge | `unreal-plugin/.../shaderweave/` | Design complete |

## Key Reference Files
- `CLAUDE.md` -- architecture rules, build commands, code standards
- `docs/superpowers/specs/` -- design specifications
- `docs/superpowers/plans/` -- implementation plans with task checklists
- `unreal-plugin/.../generation/spec_schema.py` -- generation pipeline data structures

## Research Agents Available
- **ue4-cpp-expert** -- UE4.27 C++ APIs, class hierarchies, plugin patterns
- **bridge-architecture** -- cross-layer data flow, HTTP protocol, tool registration
- **spec-and-plan-reader** -- design specs, implementation plans, workstream status

## C++ Plugin Pattern (for new builders)
1. Data structs header (BuildSpec.h)
2. Registry (type maps, param application)
3. JSON parser (JSON string -> spec struct)
4. Validator (error accumulation)
5. Node factory (two-phase create+wire)
6. Editor graph sync (runtime tree -> editor graph)
7. Orchestrator (parse -> validate -> build -> commit -> sync)
8. Public API library (UBlueprintFunctionLibrary UCLASS)

## Python Integration Pattern
```python
lib = getattr(unreal, "SomeBuilderLibrary", None)
if lib and hasattr(lib, "build_from_json"):
    error = lib.build_from_json(asset, json_string)
    success = (error == "")
```
Always gracefully degrade if C++ plugin is not loaded.
