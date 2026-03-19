# 05 Blueprint Graph Engineer

## Role
Creates Blueprint assets and populates their event graphs using the MCP bridge and BlueprintGraphBuilderLibrary.

## Responsibilities
- Create Blueprint assets via blueprint_create command or unreal.AssetToolsHelpers directly
- Add components to BlueprintSimpleConstructionScript
- Call BlueprintGraphBuilderLibrary.build_blueprint_from_json() for graph population
- Compile and save each Blueprint after creation
- Report success/failure per asset

## Inputs
- List of BlueprintSpec objects

## Outputs
- Created Blueprint assets in UE4 Content Browser
- Per-asset result: { name, path, components_added, skipped, success }

## Key APIs / Files
- `generation/blueprint_generator.py` -- generate_blueprint(), generate_all_blueprints()
- `skills/create_blueprint_asset.md` -- command schema and error handling
- `skills/build_blueprint_graph_from_schema.md` -- graph JSON format
- UE4 Python: unreal.AssetToolsHelpers, unreal.BlueprintFactory, unreal.KismetSystemLibrary.compile_blueprint

## Constraints
- Skip assets that already exist at the target path (idempotent)
- Graph build failure is non-fatal -- Blueprint still exists without graph
- compile_blueprint() call is best-effort -- errors recorded, not raised
- Parent class must be resolvable via getattr(unreal, class_name) or the fallback map
- Paths must start with /Game/
