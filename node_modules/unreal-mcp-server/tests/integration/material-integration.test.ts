/**
 * Integration test: material workflow.
 *
 * Tests the full material pipeline: list materials, inspect, create a
 * material instance with parameters, apply to an actor, screenshot to verify.
 *
 * Requires a running UE4.27 instance with the MCP Bridge listener.
 *
 * Run: npx tsx mcp-server/tests/integration/material-integration.test.ts
 */

import { UnrealClient } from "../../src/unreal-client.js";
import { createActorTools } from "../../src/tools/actors.js";
import { createMaterialTools } from "../../src/tools/materials.js";
import { createViewportTools } from "../../src/tools/viewport.js";
import { createSystemTools } from "../../src/tools/system.js";
import type { ToolDefinition } from "../../src/types.js";

const client = new UnrealClient();
const allTools: ToolDefinition[] = [
  ...createSystemTools(client),
  ...createActorTools(client),
  ...createMaterialTools(client),
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

const TEST_ACTOR = "MCPBridge_MaterialTest_Cube";
const TEST_MATERIAL = "MI_IntegrationTest_Red";

async function run(): Promise<void> {
  let step = 0;
  const log = (msg: string) => console.log(`  [${++step}] ${msg}`);

  try {
    // Step 1: Verify UE4 is alive
    log("test_connection");
    const ping = await callTool("test_connection");
    assert(ping.success === true, "UE4 must be running");
    console.log(`       Engine: ${(ping.data as Record<string, unknown>).engine_version}`);

    // Step 2: Spawn a test cube
    log("actor_spawn test cube");
    const spawn = await callTool("actor_spawn", {
      asset_path: "/Engine/BasicShapes/Cube",
      location: { x: 500, y: 0, z: 100 },
      name: TEST_ACTOR,
      folder: "MCPBridge_Test",
    });
    assert(spawn.success === true, `Spawn failed: ${spawn.error}`);

    // Step 3: List available materials
    log("material_list");
    const listResult = await callTool("material_list", { limit: 50 });
    assert(listResult.success === true, `material_list failed: ${listResult.error}`);
    const listData = listResult.data as Record<string, unknown>;
    console.log(`       Found ${listData.count} materials`);

    // Step 4: Inspect a material from the list (if any exist)
    const materials = listData.materials as Array<Record<string, unknown>>;
    if (materials.length > 0) {
      const firstMat = materials[0];
      log(`material_info on ${firstMat.name}`);
      const infoResult = await callTool("material_info", { material_path: firstMat.path as string });
      assert(infoResult.success === true, `material_info failed: ${infoResult.error}`);
      const infoData = infoResult.data as Record<string, unknown>;
      console.log(`       Type: ${infoData.type}, Parent: ${infoData.parent || "none"}`);
    } else {
      log("material_info (skipped, no materials found)");
    }

    // Step 5: Create a new MaterialInstanceConstant with a red color
    log("material_create red instance");
    const createResult = await callTool("material_create", {
      name: TEST_MATERIAL,
      path: "/Game/Materials",
      type: "instance",
      parent: materials.length > 0
        ? (materials.find((m) => m.type === "material") || materials[0]).path as string
        : "/Engine/BasicShapes/BasicShapeMaterial",
      parameters: {
        vector: { BaseColor: [1.0, 0.0, 0.0, 1.0] },
        scalar: { Roughness: 0.3 },
      },
    });
    assert(createResult.success === true, `material_create failed: ${createResult.error}`);
    const createData = createResult.data as Record<string, unknown>;
    console.log(`       Created: ${createData.path}`);

    // Step 6: Apply new instance to the test cube
    log("material_apply to test cube");
    const applyResult = await callTool("material_apply", {
      actor_name: TEST_ACTOR,
      material_path: createData.path as string,
    });
    assert(applyResult.success === true, `material_apply failed: ${applyResult.error}`);
    const applyData = applyResult.data as Record<string, unknown>;
    console.log(`       Applied to slot ${applyData.slot_index}, previous: ${applyData.previous_material}`);

    // Step 7: Focus on the test cube
    log("viewport_focus on test cube");
    const focusResult = await callTool("viewport_focus", { actor_name: TEST_ACTOR, distance: 500 });
    assert(focusResult.success === true, `viewport_focus failed: ${focusResult.error}`);

    // Step 8: Screenshot to verify material
    log("viewport_screenshot");
    const ssResult = await callTool("viewport_screenshot", {
      filename: "material_integration_test.png",
    });
    assert(ssResult.success === true, `viewport_screenshot failed: ${ssResult.error}`);
    const ssData = ssResult.data as Record<string, unknown>;
    console.log(`       Screenshot: ${ssData.filepath}`);

    // Step 9: Verify created instance through material_info
    log("material_info on created instance");
    const verifyResult = await callTool("material_info", {
      material_path: createData.path as string,
    });
    assert(verifyResult.success === true, `material_info verify failed: ${verifyResult.error}`);
    const verifyData = verifyResult.data as Record<string, unknown>;
    assert(verifyData.type === "instance", "Should be an instance");
    console.log(`       Verified: ${verifyData.name} is ${verifyData.type}`);

    // Step 10: Cleanup
    log("actor_delete cleanup");
    const deleteResult = await callTool("actor_delete", { actor_name: TEST_ACTOR });
    assert(deleteResult.success === true, `Cleanup failed: ${deleteResult.error}`);

    console.log(`\n  All ${step} steps passed.`);
  } catch (err) {
    console.error(`\n  FAILED at step ${step}: ${(err as Error).message}`);
    // Try cleanup
    try {
      await callTool("actor_delete", { actor_name: TEST_ACTOR });
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Integration test crashed:", err);
  process.exit(1);
});
