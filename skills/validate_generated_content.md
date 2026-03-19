# Skill: validate_generated_content

Check that generated assets exist, are the right type, and are compiled.

## Check asset exists
```python
import unreal
exists = unreal.EditorAssetLibrary.does_asset_exist("/Game/Generated/Gameplay/BP_MyActor")
```

## Check Blueprint is compiled
```python
bp = unreal.EditorAssetLibrary.load_asset("/Game/Generated/Gameplay/BP_MyActor")
is_bp = isinstance(bp, unreal.Blueprint)
compiled = bp.get_editor_property("generated_class") is not None if is_bp else False
```

## Bulk validation from spec
```python
from generation.spec_schema import BuildSpec

def validate_spec_assets(spec: BuildSpec) -> dict:
    import unreal
    results = {"passed": [], "failed": []}
    for bp_spec in spec.blueprints:
        path = f"{bp_spec.content_path}/{bp_spec.name}"
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            bp = unreal.EditorAssetLibrary.load_asset(path)
            compiled = (isinstance(bp, unreal.Blueprint) and
                       bp.get_editor_property("generated_class") is not None)
            (results["passed"] if compiled else results["failed"]).append(path)
        else:
            results["failed"].append(f"{path} (missing)")
    for w_spec in spec.widgets:
        path = f"{w_spec.content_path}/{w_spec.name}"
        key = "passed" if unreal.EditorAssetLibrary.does_asset_exist(path) else "failed"
        results[key].append(path)
    for l_spec in spec.levels:
        path = f"{l_spec.content_path}/{l_spec.name}"
        key = "passed" if unreal.EditorAssetLibrary.does_asset_exist(path) else "failed"
        results[key].append(path)
    return results
```

## Check manifest on disk
```python
from generation.manifest import read_manifest
manifest = read_manifest("PromptBrushOutput/manifest_abc123.json")
gen = manifest["generation"]
bp_total = gen["blueprints"]["total"]
bp_ok = gen["blueprints"]["succeeded"]
```

## Pass/fail thresholds
- Blueprints: all must exist; compiled count should be >= 80% of total
- Widgets: all must exist (compile status not checked separately for WBPs)
- Materials: all must exist
- Maps: all must exist
- Data assets: all must exist (compile not applicable)
