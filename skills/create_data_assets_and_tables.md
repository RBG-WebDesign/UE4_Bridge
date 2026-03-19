# Skill: create_data_assets_and_tables

Create data assets, curves, enums, structs, and data tables in UE4.27 via Python.

## DataAsset (generic stub)
```python
import unreal
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
factory = unreal.DataAssetFactory()
asset = asset_tools.create_asset("DA_MyData", "/Game/Generated/Data", unreal.DataAsset, factory)
unreal.EditorAssetLibrary.save_asset("/Game/Generated/Data/DA_MyData")
```

## CurveFloat
```python
factory = unreal.CurveFloatFactory()
curve = asset_tools.create_asset("Curve_Speed", "/Game/Generated/Data", unreal.CurveFloat, factory)
unreal.EditorAssetLibrary.save_asset("/Game/Generated/Data/Curve_Speed")
```

## Material (flat color)
```python
factory = unreal.MaterialFactoryNew()
mat = asset_tools.create_asset("M_MyMat", "/Game/Generated/Art", unreal.Material, factory)
# Set base color if MaterialEditingLibrary available
mel = getattr(unreal, "MaterialEditingLibrary", None)
if mel:
    expr = mel.create_material_expression(mat, unreal.MaterialExpressionConstant4Vector, -400, 0)
    expr.set_editor_property("constant", unreal.LinearColor(1.0, 0.1, 0.1, 1.0))
    mel.connect_material_property(expr, "rgba", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.recompile_material(mat)
unreal.EditorAssetLibrary.save_asset("/Game/Generated/Art/M_MyMat")
```

## DataTable (requires row struct)
DataTable creation from Python requires a pre-existing UScriptStruct row type.
In 4.27 Python, this is unreliable. Use a DataAsset stub instead and note the limitation.

## Enum / Struct (limited in 4.27 Python)
Enum and Struct Blueprint assets are not reliably creatable from Python factories.
Use DataAsset stub with the same name as a placeholder.

## Pipeline function
```python
from generation.asset_generator import generate_data_asset
from generation.spec_schema import DataAssetSpec

spec = DataAssetSpec(name="DA_MyData", content_path="/Game/Data", asset_type="DataAsset")
ok, err, data = generate_data_asset(spec)
```
