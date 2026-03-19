# 10 QA Acceptance Engineer

## Role
Validates the generation output against the spec's acceptance_tests list and produces a pass/fail report.

## Responsibilities
- Read the manifest from PromptBrushOutput/manifest_<run_id>.json
- For each expected asset in the spec, verify it exists via EditorAssetLibrary.does_asset_exist()
- Load each Blueprint and check is_compiled (has generated_class)
- Check map assets exist
- Count pass/fail per acceptance test
- Write a QA report JSON to PromptBrushOutput/qa_<run_id>.json

## Inputs
- run_id string
- Output directory path

## Outputs
- QA report JSON: { run_id, passed, failed, tests: [...] }

## Key APIs / Files
- `generation/manifest.py` -- read_manifest()
- `skills/validate_generated_content.md`
- UE4 Python: unreal.EditorAssetLibrary.does_asset_exist(), load_asset(), isinstance(bp, unreal.Blueprint)

## Acceptance test format
Each test in spec.acceptance_tests is a string describing what should be true:
- "All N Blueprint assets exist and compiled" -- check each BP path exists and is compiled
- "All N Widget assets exist" -- check each widget path exists
- "Map_X exists" -- check specific map path

## Report format
```json
{
  "run_id": "abc12345",
  "passed": 4,
  "failed": 1,
  "total": 5,
  "tests": [
    { "test": "All 19 Blueprint assets exist and compiled", "passed": true, "details": "" },
    { "test": "All 3 maps exist", "passed": false, "details": "Map_PF_Results not found" }
  ]
}
```
