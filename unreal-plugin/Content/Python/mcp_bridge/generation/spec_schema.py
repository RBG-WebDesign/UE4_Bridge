# spec_schema.py -- BuildSpec dataclass definitions for PromptBrush generation pipeline.
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CppClassSpec:
    name: str                        # e.g. "GridManager" -- used as filename
    parent_class: str                # e.g. "Actor", "ActorComponent"
    content_path: str                # Blueprint lives here e.g. /Game/Generated/Gameplay
    source_path: str                 # relative to project Source/ e.g. Generated/
    properties: List[Dict[str, Any]] = field(default_factory=list)
    functions: List[str] = field(default_factory=list)
    generate_cpp: bool = False       # if True, write .h/.cpp; if False, Blueprint only


@dataclass
class BlueprintSpec:
    name: str                        # asset name e.g. BP_GridManager
    parent_class: str                # e.g. Actor, GameModeBase
    content_path: str                # e.g. /Game/Generated/Gameplay
    components: List[Dict[str, Any]] = field(default_factory=list)
    variables: List[Dict[str, Any]] = field(default_factory=list)
    graph_json: Optional[Dict[str, Any]] = None  # passed to BlueprintGraphBuilderLibrary


@dataclass
class WidgetSpec:
    name: str                        # asset name e.g. WBP_HUD
    content_path: str                # e.g. /Game/Generated/UI
    root_widget: Dict[str, Any] = field(default_factory=dict)  # widget tree JSON


@dataclass
class MaterialSpec:
    name: str
    content_path: str
    base_color: Optional[List[float]] = None  # [r, g, b, a]
    is_instance: bool = False
    parent_material_path: Optional[str] = None


@dataclass
class DataAssetSpec:
    name: str
    content_path: str
    asset_type: str   # "DataAsset", "DataTable", "CurveFloat", "Enum", "Struct"
    row_struct: Optional[str] = None
    rows: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class LevelSpec:
    name: str                        # e.g. Map_Gameplay
    content_path: str                # e.g. /Game/Generated/Maps
    actors: List[Dict[str, Any]] = field(default_factory=list)  # actor placement defs
    camera_location: Optional[List[float]] = None
    lighting: str = "default"        # "default" | "dark" | "bright"


@dataclass
class InputMappingSpec:
    action_mappings: List[Dict[str, Any]] = field(default_factory=list)
    axis_mappings: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class BuildSpec:
    feature_name: str
    genre: str                       # e.g. "puzzle_fighter", "horror", "platformer"
    description: str                 # original user prompt
    blueprints: List[BlueprintSpec] = field(default_factory=list)
    widgets: List[WidgetSpec] = field(default_factory=list)
    cpp_classes: List[CppClassSpec] = field(default_factory=list)
    materials: List[MaterialSpec] = field(default_factory=list)
    data_assets: List[DataAssetSpec] = field(default_factory=list)
    levels: List[LevelSpec] = field(default_factory=list)
    input_mappings: InputMappingSpec = field(default_factory=InputMappingSpec)
    placeholder_policy: str = "generate"  # "generate" | "skip" | "stub_only"
    acceptance_tests: List[str] = field(default_factory=list)


def spec_to_dict(spec: BuildSpec) -> Dict[str, Any]:
    """Recursively convert a BuildSpec to a plain dict for JSON serialization."""
    import dataclasses

    def _convert(obj: Any) -> Any:
        if dataclasses.is_dataclass(obj):
            return {k: _convert(v) for k, v in dataclasses.asdict(obj).items()}
        if isinstance(obj, list):
            return [_convert(i) for i in obj]
        if isinstance(obj, dict):
            return {k: _convert(v) for k, v in obj.items()}
        return obj

    return _convert(spec)
