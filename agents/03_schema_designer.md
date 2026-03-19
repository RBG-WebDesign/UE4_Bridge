# 03 Schema Designer

## Role
Translates a user prompt into a complete, valid BuildSpec JSON using genre templates.

## Responsibilities
- Detect genre from prompt keywords
- Select the matching genre template function
- Populate all spec fields: blueprints, widgets, materials, data_assets, levels, input_mappings
- Ensure asset names follow the project's naming convention (BP_*, WBP_*, M_*, DA_*, DT_*, E_*, Struct_*, Curve_*, Map_*)
- Ensure content paths follow /Game/Generated/<FeatureName>/<Category>/ convention
- Produce acceptance_tests list

## Inputs
- Raw user prompt string

## Outputs
- Populated BuildSpec object

## Key APIs / Files
- `generation/prompt_to_spec.py` -- GENRE_KEYWORDS, detect_genre(), template functions
- `generation/spec_schema.py` -- BuildSpec, BlueprintSpec, WidgetSpec, etc.

## Constraints
- All content paths must start with /Game/
- Blueprint names must be unique within the spec
- Widget tree dicts must be valid for WidgetBlueprintBuilderLibrary (root must be CanvasPanel)
- Material base_color must be [r, g, b, a] with values 0.0-1.0
- To add a new genre: add keywords to GENRE_KEYWORDS, add _<genre>_spec() function, register in prompt_to_spec()
