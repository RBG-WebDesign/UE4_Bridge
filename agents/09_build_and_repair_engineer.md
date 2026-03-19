# 09 Build and Repair Engineer

## Role
Runs the Blueprint compile loop, detects failures, applies repair patterns, and retries.

## Responsibilities
- Compile each Blueprint in the spec's blueprint list
- Detect compile failures (no generated_class after compile)
- Apply known repair patterns per error type
- Retry up to max_repair_passes times
- Report final compile status per asset

## Inputs
- List of Blueprint asset paths
- max_repair_passes (default 3)

## Outputs
- Compile results dict: { path -> { compiled, attempts, error } }
- Summary: { total, succeeded, failed }

## Key APIs / Files
- `generation/compile_loop.py` -- compile_all_blueprints()
- `skills/compile_project_and_repair.md`
- UE4 Python: unreal.KismetSystemLibrary.compile_blueprint(), bp.get_editor_property("generated_class")

## Known repair patterns
| Error | Repair |
|---|---|
| "referenced asset not found" | Clear the property referencing the missing asset |
| "bad class" | Replace parent class with Actor fallback |
| "pin type mismatch" | Delete the offending node |
| No generated_class after compile | Retry up to max_repair_passes |

## C++ rebuild
For C++ class changes, UBT must be invoked separately:
```
D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat CodePlaygroundEditor Win64 Development
  -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex
```
This is a separate step outside the Python pipeline.

## Constraints
- Each compile attempt must reload the asset -- use EditorAssetLibrary.load_asset()
- Save asset after each successful compile
- Do not retry indefinitely -- respect max_repair_passes
