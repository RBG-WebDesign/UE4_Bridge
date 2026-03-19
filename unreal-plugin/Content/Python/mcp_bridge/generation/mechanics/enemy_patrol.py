"""enemy_patrol mechanic -- adds enemy character, AI controller, blackboard, behavior tree,
and red material to a BuildSpec.
"""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BehaviorTreeSpec,
    BlackboardSpec,
    BlueprintSpec,
    BuildSpec,
    IntentMap,
    MaterialSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


@register_mechanic("enemy_patrol")
def apply_enemy_patrol(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add enemy patrol assets to spec.

    Adds:
    - BP_{feature_name}_Enemy (parent: Character) with StaticMeshComponent("EnemyMesh")
      + SphereComponent("DetectionSphere")
    - BP_{feature_name}_AIController (parent: AIController)
    - BB_{feature_name}_Enemy (Blackboard) with keys: TargetActor (Object),
      PatrolLocation (Vector), bIsAlerted (Bool), AlertLevel (Float)
    - BT_{feature_name}_Enemy (BehaviorTree) with Selector root containing
      two Sequences (MoveTo + Wait)
    - M_{feature_name}_Enemy (Material) with red base_color [0.8, 0.1, 0.1, 1.0]
    """
    gameplay_path = f"/Game/Generated/{intent.feature_name}/Gameplay"
    ai_path = f"/Game/Generated/{intent.feature_name}/AI"
    art_path = f"/Game/Generated/{intent.feature_name}/Art"

    # Enemy Blueprint with mesh and detection sphere.
    enemy_bp = BlueprintSpec(
        name=f"BP_{intent.feature_name}_Enemy",
        parent_class="Character",
        content_path=gameplay_path,
        components=[
            {"type": "StaticMeshComponent", "name": "EnemyMesh"},
            {"type": "SphereComponent", "name": "DetectionSphere", "attach_to": "RootComponent"},
        ],
    )

    # AIController Blueprint.
    ai_controller_bp = BlueprintSpec(
        name=f"BP_{intent.feature_name}_AIController",
        parent_class="AIController",
        content_path=gameplay_path,
    )

    spec.blueprints.extend([enemy_bp, ai_controller_bp])

    # Blackboard with patrol and alert state keys.
    blackboard = BlackboardSpec(
        name=f"BB_{intent.feature_name}_Enemy",
        content_path=ai_path,
        keys=[
            {"name": "TargetActor", "type": "Object"},
            {"name": "PatrolLocation", "type": "Vector"},
            {"name": "bIsAlerted", "type": "Bool"},
            {"name": "AlertLevel", "type": "Float"},
        ],
    )
    spec.blackboards.append(blackboard)

    # Behavior Tree with Selector root and two Sequences (MoveTo + Wait).
    behavior_tree = BehaviorTreeSpec(
        name=f"BT_{intent.feature_name}_Enemy",
        content_path=ai_path,
        blackboard_path=f"{ai_path}/BB_{intent.feature_name}_Enemy",
        root={
            "type": "Selector",
            "children": [
                {
                    "type": "Sequence",
                    "children": [
                        {"type": "BTTask_MoveTo", "params": {}},
                        {"type": "BTTask_Wait", "params": {"WaitTime": 2.0}},
                    ],
                },
                {
                    "type": "Sequence",
                    "children": [
                        {"type": "BTTask_MoveTo", "params": {}},
                        {"type": "BTTask_Wait", "params": {"WaitTime": 1.0}},
                    ],
                },
            ],
        },
    )
    spec.behavior_trees.append(behavior_tree)

    # Red material for the enemy.
    material = MaterialSpec(
        name=f"M_{intent.feature_name}_Enemy",
        content_path=art_path,
        base_color=[0.8, 0.1, 0.1, 1.0],
    )
    spec.materials.append(material)

    return spec
