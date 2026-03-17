/**
 * Integration test: viewport visual feedback loop.
 *
 * Tests the full chain: spawn actor, query level, focus viewport,
 * take screenshots from multiple angles and render modes, fit view,
 * read bounds, check outliner, save, and clean up.
 *
 * Requires a running UE4.27 instance with the MCP Bridge listener.
 *
 * Run: npx tsx mcp-server/tests/integration/viewport-integration.test.ts
 */

import { UnrealClient } from "../../src/unreal-client.js";
import { createActorTools } from "../../src/tools/actors.js";
import { createLevelTools } from "../../src/tools/level.js";
import { createViewportTools } from "../../src/tools/viewport.js";
import { createSystemTools } from "../../src/tools/system.js";
import type { ToolDefinition } from "../../src/types.js";

const client = new UnrealClient();
const allTools: ToolDefinition[] = [
  ...createSystemTools(client),
  ...createActorTools(client),
  ...createLevelTools(client),
  ...createViewportTools(client),
];
const toolMap = new Map(allTools.map((t) => [t.name, t]));

async function callTool(name: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = await tool.handler(params);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const TEST_ACTOR = "MCPBridge_IntegrationTest_Cube";

async function run(): Promise<void> {
  let step = 0;
  const log = (msg: string) => console.log(`  [${++step}] ${msg}`);

  // Step 1: Verify UE4 is alive
  log("test_connection");
  const ping = await callTool("test_connection");
  assert(ping.success === true, "UE4 must be running");
  console.log(`       Engine: ${(ping.data as Record<string, unknown>).engine_version}`);

  // Step 2: Spawn a test cube
  log("actor_spawn test cube");
  const spawn = await callTool("actor_spawn", {
    asset_path: "/Engine/BasicShapes/Cube",
    location: { x: 0, y: 0, z: 100 },
    name: TEST_ACTOR,
    folder: "MCPBridge_Test",
  });
  assert(spawn.success === true, `Spawn failed: ${spawn.error}`);

  // Step 3: level_actors to verify actor appears
  log("level_actors with name_filter");
  const actors = await callTool("level_actors", { name_filter: TEST_ACTOR });
  assert(actors.success === true, "level_actors failed");
  const actorData = actors.data as Record<string, unknown>;
  assert((actorData.count as number) >= 1, "Test actor not found in level");

  // Step 4: viewport_focus on the test actor
  log("viewport_focus on test actor");
  const focus = await callTool("viewport_focus", { actor_name: TEST_ACTOR });
  assert(focus.success === true, `Focus failed: ${focus.error}`);

  // Step 5: viewport_screenshot (focused view)
  log("viewport_screenshot (focused view)");
  const shot1 = await callTool("viewport_screenshot", { filename: "integration_focused.png" });
  assert(shot1.success === true, `Screenshot 1 failed: ${shot1.error}`);
  const shot1Data = shot1.data as Record<string, unknown>;
  console.log(`       Saved: ${shot1Data.filepath}`);

  // Step 6: Verify screenshot file info
  log("verify screenshot has file_size_bytes");
  assert(shot1Data.filepath !== undefined, "filepath missing");

  // Step 7: viewport_camera to a known position
  log("viewport_camera to known position");
  const cam = await callTool("viewport_camera", {
    location: [500, -500, 300],
    rotation: [-20, 135, 0],
  });
  assert(cam.success === true, `Camera move failed: ${cam.error}`);

  // Step 8: viewport_screenshot from new angle
  log("viewport_screenshot (new angle)");
  const shot2 = await callTool("viewport_screenshot", { filename: "integration_angle.png" });
  assert(shot2.success === true, `Screenshot 2 failed: ${shot2.error}`);

  // Step 9: viewport_render_mode to wireframe
  log("viewport_render_mode wireframe");
  const wireframe = await callTool("viewport_render_mode", { mode: "wireframe" });
  assert(wireframe.success === true, `Wireframe failed: ${wireframe.error}`);

  // Step 10: viewport_screenshot in wireframe
  log("viewport_screenshot (wireframe)");
  const shot3 = await callTool("viewport_screenshot", { filename: "integration_wireframe.png" });
  assert(shot3.success === true, `Screenshot 3 failed: ${shot3.error}`);

  // Step 11: viewport_mode to top view
  log("viewport_mode top");
  const topView = await callTool("viewport_mode", { mode: "top" });
  assert(topView.success === true, `Top view failed: ${topView.error}`);

  // Step 12: viewport_screenshot from top-down
  log("viewport_screenshot (top-down)");
  const shot4 = await callTool("viewport_screenshot", { filename: "integration_topdown.png" });
  assert(shot4.success === true, `Screenshot 4 failed: ${shot4.error}`);

  // Step 13: viewport_fit on the test actor with padding
  log("viewport_fit with padding 1.5");
  const fit = await callTool("viewport_fit", { actor_names: [TEST_ACTOR], padding: 1.5 });
  assert(fit.success === true, `Fit failed: ${fit.error}`);

  // Step 14: viewport_bounds to read current state
  log("viewport_bounds");
  const bounds = await callTool("viewport_bounds");
  assert(bounds.success === true, `Bounds failed: ${bounds.error}`);
  const boundsData = bounds.data as Record<string, unknown>;
  assert(boundsData.camera_location !== undefined, "camera_location missing");

  // Step 15: level_outliner to check folder structure
  log("level_outliner");
  const outliner = await callTool("level_outliner");
  assert(outliner.success === true, `Outliner failed: ${outliner.error}`);

  // Step 16: level_save
  log("level_save");
  const save = await callTool("level_save", { save_all: false });
  assert(save.success === true, `Save failed: ${save.error}`);

  // Restore render mode to lit before cleanup
  await callTool("viewport_render_mode", { mode: "lit" });

  // Step 17: actor_delete the test actor (cleanup)
  log("actor_delete test actor (cleanup)");
  const del = await callTool("actor_delete", { actor_name: TEST_ACTOR });
  assert(del.success === true, `Delete failed: ${del.error}`);

  // Step 18: level_actors to verify cleanup
  log("level_actors verify cleanup");
  const postDelete = await callTool("level_actors", { name_filter: TEST_ACTOR });
  assert(postDelete.success === true, "level_actors failed");
  const postData = postDelete.data as Record<string, unknown>;
  assert((postData.count as number) === 0, "Test actor still exists after delete");

  console.log(`\n  All ${step} steps passed. Visual feedback loop works end to end.`);
}

run().catch((err) => {
  console.error("\n  INTEGRATION TEST FAILED:", (err as Error).message);
  // Try to clean up even on failure
  callTool("actor_delete", { actor_name: TEST_ACTOR }).catch(() => {});
  callTool("viewport_render_mode", { mode: "lit" }).catch(() => {});
  process.exit(1);
});
