# Skill: compile_project_and_repair

Compile Blueprints and C++ in UE4.27, detect failures, and apply repair patterns.

## Compile a single Blueprint
```python
import unreal
bp = unreal.EditorAssetLibrary.load_asset("/Game/Generated/Gameplay/BP_MyActor")
unreal.KismetSystemLibrary.compile_blueprint(bp)
gen_class = bp.get_editor_property("generated_class")
compiled = gen_class is not None
```

## Compile all Blueprints in a list
```python
from generation.compile_loop import compile_all_blueprints
results = compile_all_blueprints([
    "/Game/Generated/Gameplay/BP_MyActor",
    "/Game/Generated/Gameplay/BP_MyMode",
])
# results["succeeded"], results["failed"], results["results"][path]
```

## Compile C++ (UBT)
```
D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat CodePlaygroundEditor Win64 Development
  -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex
```
Exit code 0 = success.

## Repair patterns
| Symptom | Repair action |
|---|---|
| No generated_class after compile | Retry up to 3 times |
| "referenced asset not found" | bp.get_editor_property("default_object") then clear bad refs |
| Node pin type mismatch | Remove the offending node from the graph |
| Missing parent class | Replace parent_class with AActor via factory re-create |
| UE4 crash on compile | Save project, restart listener, retry |

## Delete stale .uasset binaries before rebuild (important)
```bash
# Before rebuilding C++ plugin
del "D:\Unreal Projects\CodePlayground\Plugins\MyPlugin\Binaries\Win64\UE4Editor-MyPlugin.dll"
del "D:\Unreal Projects\CodePlayground\Plugins\MyPlugin\Binaries\Win64\UE4Editor-MyPlugin.pdb"
```
See feedback memory: always clean DLLs before rebuild.

## Verify Blueprint is compiled
```python
bp = unreal.EditorAssetLibrary.load_asset(path)
is_compiled = bp.get_editor_property("generated_class") is not None
```
