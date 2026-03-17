# Troubleshooting

## Listener Not Starting

**Symptom:** `curl` to localhost:8080 gets "connection refused."

**Check:**
1. Is the Python Editor Script Plugin enabled? Edit > Plugins > search "Python"
2. Is `startup.py` in the right location? Must be at `YourProject/Content/Python/startup.py`
3. Check the UE4 Output Log (Window > Developer Tools > Output Log) for Python errors
4. Is the startup script configured in DefaultEngine.ini?

**Quick fix:** Open UE4's Python console (Window > Developer Tools > Python Console) and run:
```python
from mcp_bridge import listener
listener.start()
```

## Connection Refused After Listener Was Working

**Symptom:** Listener was working, now curl fails.

**Possible causes:**
- UE4 crashed or restarted without the startup script
- Another process grabbed port 8080
- The listener thread died from an unhandled exception

**Fix:** Check UE4 Output Log for errors. Restart the listener from Python console:
```python
from mcp_bridge.listener import restart
restart()
```

## Python Module Not Found

**Symptom:** `ModuleNotFoundError: No module named 'mcp_bridge'` in UE4 log.

**Fix:** Verify folder structure. The `mcp_bridge` folder must be directly inside `Content/Python/`, not nested deeper.

## MCP Server Not Connecting

**Symptom:** Claude Code says the MCP server failed to start.

**Check:**
1. Run `npm run build` in the mcp-server directory
2. Check that `mcp-server/dist/index.js` exists
3. Try running manually: `node mcp-server/dist/index.js`
4. Check `.mcp.json` points to the correct path

## Slow Responses

**Symptom:** Commands take many seconds to return.

**Possible causes:**
- Large level with many actors (level_actors can be slow)
- Asset loading on first access
- UE4 editor is busy compiling shaders

**Mitigation:** Use path/name filters to limit result sets. Wait for shader compilation to finish.

## viewport_screenshot Returns 0-Byte File

**Symptom:** `viewport_screenshot` succeeds but `file_size_bytes` is 0 or the file is empty.

**Possible causes:**
- The viewport is minimized or not visible
- No level is currently open in the editor
- The capture finished before the file was fully written to disk

**Fix:** Make sure the editor viewport is visible and a level is loaded. Try the command again -- some capture methods are async and may need a moment.

## viewport_screenshot Returns Black Image

**Symptom:** The screenshot file exists but shows a completely black image.

**Possible causes:**
- Lighting has not been built for the level
- The camera is inside geometry (e.g., inside a wall or floor)
- The level has no light sources

**Fix:** Build lighting (Build > Build Lighting Only in the editor menu). Use `viewport_camera` to move the camera to a known good position. Use `viewport_bounds` to check the current camera location.

## viewport_camera Has No Effect

**Symptom:** `viewport_camera` returns success but the viewport doesn't move.

**Possible causes:**
- The viewport is in a locked mode (e.g., locked to an actor via Pilot)
- A cinematic preview or Sequencer is controlling the camera
- The viewport is in an ortho view that ignores perspective camera settings

**Fix:** Click the viewport and press Escape to exit any locked/piloted state. Close any active Sequencer previews. Switch to perspective view with `viewport_mode` first.

## viewport_mode Ortho Views Look Wrong

**Symptom:** Switching to top/front/side views shows content at an unexpected scale or position.

**Possible causes:**
- Ortho zoom level may need adjusting after switching
- The camera was very far from the origin before switching
- Actors are at extreme distances from origin

**Fix:** After switching to an ortho mode, use `viewport_fit` to frame the actors you want to see. The ortho zoom level adapts based on the camera distance set by `viewport_fit`.

## material_create Succeeds But Parameters Not Set

**Symptom:** `material_create` returns success with `parameters_set` showing empty arrays, even though you provided parameter values.

**Possible causes:**
- `MaterialEditingLibrary` methods may not be fully available in UE4.27's Python API
- The parameter name doesn't match any parameter on the parent material
- The parent material has no exposed parameters

**Fix:** Check the UE4 Output Log for specific errors. Verify the parent material actually has the parameters you're trying to set by using `material_info` on the parent first. Parameters can be set manually in the editor after the instance is created.

## blueprint_create Skipped Variables

**Symptom:** `blueprint_create` returns `variables_skipped_reason` with a message about Python API limitations, and `variables_failed` lists the variable names.

**Possible causes:**
- Blueprint variable creation through Python is limited in UE4.27
- The `FBPVariableDescription` constructor may not be exposed to Python
- The `new_variables` array may be read-only

**Fix:** Variables need to be added manually through the Blueprint editor. Components should still be created correctly. The Blueprint itself is still usable; it just won't have the requested variables.

## blueprint_compile Hangs

**Symptom:** `blueprint_compile` takes a very long time or the request times out after 60 seconds.

**Possible causes:**
- The Blueprint has circular references or recursive macro graphs
- A complex Blueprint with many nodes can stall compilation
- UE4 editor is busy with another operation (shader compilation, asset loading)

**Fix:** Wait for any background editor operations to finish. If compile consistently hangs, open the Blueprint in the editor and check for circular dependencies. The handler will report a timeout warning if compilation takes too long.

## material_apply Shows Wrong Material in Viewport

**Symptom:** `material_apply` returns success but the viewport still shows the old material.

**Possible causes:**
- The viewport needs a refresh after material application
- The material was applied to the correct slot but the viewport hasn't re-rendered
- The material was applied to a different component than expected

**Fix:** Take another screenshot (`viewport_screenshot`) or toggle the render mode (`viewport_render_mode` to `unlit` then back to `lit`) to force a redraw. Check the `component` field in the response to confirm which mesh component received the material. Use the `component_name` parameter to target a specific component if the actor has multiple meshes.
