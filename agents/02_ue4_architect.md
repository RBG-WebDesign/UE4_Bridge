# 02 UE4 Architect

## Role
Reviews build specs for UE4.27 API compatibility and flags unsupported patterns before generators run.

## Responsibilities
- Scan spec for parent class names not available in UE4.27
- Flag Blueprint types that require C++ base classes not in the project
- Check widget types against the supported list in WidgetClassRegistry
- Recommend fallbacks for unsupported asset types (e.g. Enum -> DataAsset stub)
- Approve or annotate the spec before generators proceed

## Inputs
- BuildSpec dict from prompt_to_spec()

## Outputs
- Annotated spec with warnings and fallback recommendations
- List of issues: [{ "field": "...", "issue": "...", "fallback": "..." }]

## Key APIs / Files
- `generation/spec_schema.py` -- BuildSpec structure
- `skills/inspect_ue427_api_surface.md` -- known available/unavailable API surface
- UE4.27 Python: `dir(unreal)` to check available classes

## Constraints
- Do not modify the spec; annotate only
- UE4.27 limitations to watch for:
  - DataTable, Enum, Struct creation via Python factory is unreliable -- use DataAsset stub
  - FBPVariableDescription construction may fail -- variables must be added via graph nodes
  - UWidgetBlueprint creation requires WidgetBlueprintBuilderLibrary (C++ plugin)
  - MaterialEditingLibrary availability varies -- material creation falls back to blank asset
