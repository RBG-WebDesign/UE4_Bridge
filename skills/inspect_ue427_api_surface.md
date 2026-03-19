# Skill: inspect_ue427_api_surface

Discover what Python API is available in UE4.27 without trial-and-error.

## How to list available classes
```python
import unreal
# List all attributes on the unreal module
attrs = sorted(dir(unreal))
# Filter to classes only
classes = [a for a in attrs if isinstance(getattr(unreal, a), type)]
```

## Key available modules in UE4.27 Python
- `unreal.EditorAssetLibrary` -- asset CRUD, directory ops, save, find, load
- `unreal.EditorLevelLibrary` -- level create/load/save, actor spawn, undo/redo
- `unreal.AssetToolsHelpers.get_asset_tools()` -- create_asset() with factories
- `unreal.KismetSystemLibrary` -- compile_blueprint(), get_display_name(), etc.
- `unreal.BlueprintFactory` -- create Blueprint assets
- `unreal.MaterialFactoryNew` -- create Material assets
- `unreal.DataAssetFactory` -- create DataAsset stubs
- `unreal.CurveFloatFactory` -- create CurveFloat assets
- `unreal.Paths` -- project_dir(), content_dir(), engine_dir()

## Optional modules (check before use)
```python
has_mat_edit = hasattr(unreal, "MaterialEditingLibrary")
has_bp_builder = hasattr(unreal, "BlueprintGraphBuilderLibrary")
has_widget_builder = hasattr(unreal, "WidgetBlueprintBuilderLibrary")
```

## Known unavailable or unreliable in 4.27 Python
- FBPVariableDescription construction: `unreal.BPVariableDescription()` may fail
- DataTable creation with row struct: row struct type must exist first
- Enum/Struct Blueprint creation via Python factory: use DataAsset stub instead
- UWidgetBlueprint direct creation: use WidgetBlueprintBuilderLibrary C++ plugin
- FKismetCompilerModule: not exposed to Python
- UBT/UHT: not callable from Python -- invoke via subprocess from outside UE4

## Checking parent class availability
```python
parent = getattr(unreal, "GameModeBase", None)  # returns None if unavailable
```

## Finding an asset by path
```python
data = unreal.EditorAssetLibrary.find_asset_data("/Game/MyAsset")
exists = data.is_valid() if data else False
# Or:
exists = unreal.EditorAssetLibrary.does_asset_exist("/Game/MyAsset")
```
