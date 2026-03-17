"""Project and asset command handlers."""

import os
from typing import Any, Dict, List


def handle_project_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """Return current UE project info.
    
    Args:
        params: Unused.
    
    Returns:
        Project name, engine version, paths, loaded level.
    """
    try:
        import unreal
        
        # Get the current level name
        world = unreal.EditorLevelLibrary.get_editor_world()
        level_name = world.get_name() if world else "Unknown"
        
        return {
            "success": True,
            "data": {
                "project_name": unreal.SystemLibrary.get_game_name(),
                "engine_version": unreal.SystemLibrary.get_engine_version(),
                "project_dir": unreal.SystemLibrary.get_project_directory(),
                "content_dir": unreal.SystemLibrary.get_project_content_directory(),
                "current_level": level_name,
            }
        }
    except Exception as e:
        return {"success": False, "data": {}, "error": str(e)}


def handle_asset_list(params: Dict[str, Any]) -> Dict[str, Any]:
    """List assets with optional filters.
    
    Args:
        params: Optional filters:
            - path (str): Path prefix to search under (default: /Game/)
            - asset_type (str): Filter by asset type class name
            - name_pattern (str): Filter by name substring
            - recursive (bool): Search recursively (default: True)
    
    Returns:
        List of asset paths with types.
    """
    try:
        import unreal
        
        search_path = params.get("path", "/Game/")
        asset_type = params.get("asset_type", "")
        name_pattern = params.get("name_pattern", "")
        recursive = params.get("recursive", True)
        
        # Get asset registry
        asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()
        
        # List assets
        asset_paths = unreal.EditorAssetLibrary.list_assets(
            search_path,
            recursive=recursive,
            include_folder=False
        )
        
        results: List[Dict[str, Any]] = []
        for asset_path in asset_paths:
            # Apply name filter
            if name_pattern and name_pattern.lower() not in asset_path.lower():
                continue
            
            # Get asset data
            asset_data = unreal.EditorAssetLibrary.find_asset_data(asset_path)
            if not asset_data:
                continue
            
            asset_class = str(asset_data.asset_class)
            
            # Apply type filter
            if asset_type and asset_type.lower() != asset_class.lower():
                continue
            
            results.append({
                "path": asset_path,
                "type": asset_class,
                "name": os.path.basename(asset_path),
            })
        
        return {
            "success": True,
            "data": {
                "count": len(results),
                "assets": results,
            }
        }
    except Exception as e:
        return {"success": False, "data": {}, "error": str(e)}


def handle_asset_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """Return detailed info for a single asset.
    
    Args:
        params: Required:
            - path (str): Asset path (e.g., /Game/Meshes/SM_Cube)
    
    Returns:
        Detailed asset information including type, size, and type-specific metadata.
    """
    try:
        import unreal
        
        asset_path = params.get("path", "")
        if not asset_path:
            return {"success": False, "data": {}, "error": "Missing 'path' parameter"}
        
        if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            return {"success": False, "data": {}, "error": f"Asset not found: {asset_path}"}
        
        asset = unreal.EditorAssetLibrary.load_asset(asset_path)
        if asset is None:
            return {"success": False, "data": {}, "error": f"Failed to load asset: {asset_path}"}
        
        asset_data = unreal.EditorAssetLibrary.find_asset_data(asset_path)
        
        info: Dict[str, Any] = {
            "path": asset_path,
            "type": str(asset_data.asset_class) if asset_data else "Unknown",
            "name": str(asset.get_name()),
        }
        
        # Static mesh specific info
        if isinstance(asset, unreal.StaticMesh):
            info["lod_count"] = asset.get_num_lods()
            info["material_slots"] = []
            for i in range(asset.get_num_sections(0)):
                mat = asset.get_material(i)
                info["material_slots"].append({
                    "index": i,
                    "material": str(mat.get_name()) if mat else None,
                })
            # Bounds
            bounds = asset.get_bounds()
            if bounds:
                info["bounds"] = {
                    "origin": {"x": bounds.origin.x, "y": bounds.origin.y, "z": bounds.origin.z},
                    "extent": {"x": bounds.box_extent.x, "y": bounds.box_extent.y, "z": bounds.box_extent.z},
                }
        
        # Skeletal mesh specific info
        elif isinstance(asset, unreal.SkeletalMesh):
            info["lod_count"] = asset.get_num_lods() if hasattr(asset, 'get_num_lods') else 0
            info["skeleton"] = str(asset.skeleton.get_name()) if asset.skeleton else None
        
        return {
            "success": True,
            "data": info,
        }
    except Exception as e:
        return {"success": False, "data": {}, "error": str(e)}
