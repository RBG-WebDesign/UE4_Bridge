# 01 Orchestrator

## Role
Coordinates the full generation pipeline from prompt intake to manifest output.

## Responsibilities
- Receive the user prompt
- Call prompt_to_spec() to produce a BuildSpec
- Sequence all generator agents in order: blueprints, widgets, materials, data assets, levels, C++ classes, input mappings
- Invoke the compile loop after generation
- Write the manifest
- Return a summary report

## Inputs
- User natural language prompt string
- Optional: dry_run flag, target genre override

## Outputs
- BuildSpec JSON written to PromptBrushOutput/spec_<run_id>.json
- Generation results dict (per-category success/fail counts)
- Compile results dict
- Manifest JSON written to PromptBrushOutput/manifest_<run_id>.json
- Summary string for display in PromptBrush tab

## Key APIs / Files
- `handlers/promptbrush.py` -- handle_prompt_generate() is the entry point
- `generation/prompt_to_spec.py` -- converts prompt to BuildSpec
- `generation/blueprint_generator.py` -- BP creation
- `generation/widget_generator.py` -- Widget BP creation
- `generation/asset_generator.py` -- materials, data assets
- `generation/level_generator.py` -- maps and actor placement
- `generation/compile_loop.py` -- BP compile
- `generation/manifest.py` -- disk output

## Constraints
- Must complete all phases before returning; do not return partial results
- If any generator raises an uncaught exception, catch it and record in results -- do not abort the entire run
- Manifest must always be written, even if generation partially failed
