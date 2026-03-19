# Skill: generate_placeholder_art_audio_vfx

Create minimal placeholder art, audio, and VFX assets in UE4.27.

## Flat-color material (usable immediately)
```python
import unreal
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
factory = unreal.MaterialFactoryNew()
mat = asset_tools.create_asset("M_Red", "/Game/Generated/Art", unreal.Material, factory)
mel = getattr(unreal, "MaterialEditingLibrary", None)
if mel:
    expr = mel.create_material_expression(mat, unreal.MaterialExpressionConstant4Vector, -400, 0)
    expr.set_editor_property("constant", unreal.LinearColor(1.0, 0.0, 0.0, 1.0))
    mel.connect_material_property(expr, "rgba", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.recompile_material(mat)
unreal.EditorAssetLibrary.save_asset("/Game/Generated/Art/M_Red")
```

## CurveFloat placeholder
```python
factory = unreal.CurveFloatFactory()
curve = asset_tools.create_asset("Curve_Speed", "/Game/Generated/Data", unreal.CurveFloat, factory)
unreal.EditorAssetLibrary.save_asset("/Game/Generated/Data/Curve_Speed")
```

## Sound cue stub
SoundCue creation via Python is unreliable in 4.27.
Preferred approach: create a DataAsset stub named `SC_MySound` as placeholder.
This can be replaced with a real SoundCue via the Content Browser later.

## Niagara system stub
NiagaraSystem creation via Python factory is not available in 4.27 Python.
Create a DataAsset stub named `NS_MyEffect` as placeholder.

## Texture placeholder
Texture2D creation with fill from Python is unsupported in 4.27 Python scripting layer.
Use placeholder material (flat color) instead of texture.
If needed: write a raw .png file to disk and import via `unreal.AssetToolsHelpers.import_asset_tasks()`.

## Import asset from disk
```python
import_task = unreal.AssetImportTask()
import_task.filename = "C:/Temp/placeholder.png"
import_task.destination_path = "/Game/Generated/Art"
import_task.replace_existing = False
import_task.automated = True
asset_tools.import_asset_tasks([import_task])
```

## Policy for missing assets
When `placeholder_policy == "generate"`:
- Materials: create flat-color material
- Textures: create flat-color material named T_<name> as stand-in
- Sounds: create DataAsset stub
- Niagara: create DataAsset stub
- Meshes: leave empty (StaticMeshActor with no mesh assigned is valid)
