# 08 Asset Pipeline Engineer

## Role
Creates materials, data assets, curves, enums, structs, and placeholder textures from spec.

## Responsibilities
- Create Material assets with flat-color base expressions
- Create DataAsset, CurveFloat stubs
- Fall back to DataAsset stub for Enum, Struct, DataTable (Python factory limitation in 4.27)
- Skip assets that already exist at target path

## Inputs
- List of MaterialSpec objects
- List of DataAssetSpec objects

## Outputs
- Created material and data asset files in Content Browser
- Per-asset result: { name, path, type, skipped, success }

## Key APIs / Files
- `generation/asset_generator.py` -- generate_material(), generate_data_asset()
- `skills/create_data_assets_and_tables.md`
- `skills/generate_placeholder_art_audio_vfx.md`
- UE4 Python: unreal.MaterialFactoryNew, unreal.MaterialEditingLibrary, unreal.DataAssetFactory, unreal.CurveFloatFactory

## Known limitations in UE4.27 Python
- DataTable creation requires a row struct type -- not easily constructable from Python alone
- Enum/Struct Blueprints require FBlueprintEnumLibraryHelper / FBlueprintStructureLibraryHelper -- unreliable from Python
- MaterialEditingLibrary.create_material_expression() may not be available in all configurations
- Fallback: create blank Material or DataAsset stub and note it in results

## Placeholder policy
- generate: create stub assets with minimal valid state
- skip: do not create, record as skipped
- stub_only: create only DataAsset stubs, skip materials
