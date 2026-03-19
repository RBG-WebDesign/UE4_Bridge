# compile_loop.py -- Blueprint compile and repair iteration.
from __future__ import annotations
from typing import Any, Dict, List


def compile_all_blueprints(
    blueprint_paths: List[str], max_repair_passes: int = 3
) -> Dict[str, Any]:
    """Compile all blueprints, retrying failed ones up to max_repair_passes times.

    Returns a summary with per-asset compile status.
    """
    try:
        import unreal

        results: Dict[str, Any] = {}

        for bp_path in blueprint_paths:
            compiled = False
            last_error = ""

            for attempt in range(max_repair_passes):
                bp = unreal.EditorAssetLibrary.load_asset(bp_path)
                if bp is None:
                    last_error = "Asset not found"
                    break
                if not isinstance(bp, unreal.Blueprint):
                    last_error = "Not a Blueprint"
                    break

                try:
                    unreal.KismetSystemLibrary.compile_blueprint(bp)
                    gen_class = bp.get_editor_property("generated_class")
                    if gen_class is not None:
                        compiled = True
                        try:
                            unreal.EditorAssetLibrary.save_asset(bp_path)
                        except Exception:
                            pass
                        break
                    else:
                        last_error = "No generated class after compile"
                except Exception as e:
                    last_error = str(e)

            results[bp_path] = {
                "compiled": compiled,
                "attempts": max_repair_passes if not compiled else 1,
                "error": last_error if not compiled else "",
            }

        total = len(blueprint_paths)
        succeeded = sum(1 for v in results.values() if v["compiled"])
        return {
            "results": results,
            "total": total,
            "succeeded": succeeded,
            "failed": total - succeeded,
        }

    except Exception as e:
        return {
            "error": str(e),
            "results": {},
            "total": 0,
            "succeeded": 0,
            "failed": 0,
        }
