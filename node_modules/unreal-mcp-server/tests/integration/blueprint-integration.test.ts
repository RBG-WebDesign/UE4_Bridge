/**
 * Integration test: blueprint workflow.
 *
 * Tests the full Blueprint pipeline: create a Blueprint with components,
 * compile, inspect, list, document, spawn an instance, focus, screenshot.
 *
 * Requires a running UE4.27 instance with the MCP Bridge listener.
 *
 * Run: npx tsx mcp-server/tests/integration/blueprint-integration.test.ts
 */

import { UnrealClient } from "../../src/unreal-client.js";
import { createActorTools } from "../../src/tools/actors.js";
import { createBlueprintTools } from "../../src/tools/blueprints.js";
import { createViewportTools } from "../../src/tools/viewport.js";
import { createSystemTools } from "../../src/tools/system.js";
import type { ToolDefinition } from "../../src/types.js";

const client = new UnrealClient();
const allTools: ToolDefinition[] = [
  ...createSystemTools(client),
  ...createActorTools(client),
  ...createBlueprintTools(client),
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

const TEST_BP = "BP_IntegrationTest";
const TEST_ACTOR = "MCPBridge_BPTest_Instance";

async function run(): Promise<void> {
  let step = 0;
  const log = (msg: string) => console.log(`  [${++step}] ${msg}`);

  try {
    // Step 1: Verify UE4 is alive
    log("test_connection");
    const ping = await callTool("test_connection");
    assert(ping.success === true, "UE4 must be running");
    console.log(`       Engine: ${(ping.data as Record<string, unknown>).engine_version}`);

    // Step 2: Create Blueprint with a BoxComponent
    log("blueprint_create with BoxComponent");
    const createResult = await callTool("blueprint_create", {
      name: TEST_BP,
      path: "/Game/Blueprints",
      parent_class: "Actor",
      components: [
        { name: "DefaultSceneRoot", class: "SceneComponent" },
        { name: "TriggerBox", class: "BoxComponent", attach_to: "DefaultSceneRoot" },
      ],
      variables: [
        { name: "TriggerEnabled", type: "Boolean", category: "Conditions", tooltip: "Whether this trigger is active" },
      ],
    });
    assert(createResult.success === true, `blueprint_create failed: ${createResult.error}`);
    const createData = createResult.data as Record<string, unknown>;
    console.log(`       Created: ${createData.path}`);
    console.log(`       Components added: ${(createData.components_added as string[]).join(", ")}`);
    console.log(`       Variables added: ${(createData.variables_added as string[]).join(", ") || "none (may be skipped in 4.27)"}`);

    // Step 3: Verify structure with blueprint_info
    log("blueprint_info");
    const infoResult = await callTool("blueprint_info", {
      blueprint_path: createData.path as string,
    });
    assert(infoResult.success === true, `blueprint_info failed: ${infoResult.error}`);
    const infoData = infoResult.data as Record<string, unknown>;
    assert(infoData.parent_class === "Actor", "Parent should be Actor");
    console.log(`       Components: ${infoData.component_count}, Variables: ${infoData.variable_count}`);

    // Step 4: Compile
    log("blueprint_compile");
    const compileResult = await callTool("blueprint_compile", {
      blueprint_path: createData.path as string,
    });
    assert(compileResult.success === true, `blueprint_compile failed: ${compileResult.error}`);
    const compileData = compileResult.data as Record<string, unknown>;
    console.log(`       Compiled: ${compileData.compiled}, Errors: ${compileData.had_errors}`);

    // Step 5: Verify it appears in blueprint_list
    log("blueprint_list");
    const listResult = await callTool("blueprint_list", {
      name_filter: `${TEST_BP}*`,
    });
    assert(listResult.success === true, `blueprint_list failed: ${listResult.error}`);
    const listData = listResult.data as Record<string, unknown>;
    assert((listData.count as number) >= 1, "Blueprint should appear in list");
    console.log(`       Found ${listData.count} matching blueprints`);

    // Step 6: Generate documentation
    log("blueprint_document");
    const docResult = await callTool("blueprint_document", {
      blueprint_path: createData.path as string,
      detail_level: "standard",
    });
    assert(docResult.success === true, `blueprint_document failed: ${docResult.error}`);
    const docData = docResult.data as Record<string, unknown>;
    const doc = docData.documentation as string;
    assert(doc.length > 0, "Documentation should be non-empty");
    console.log(`       Documentation length: ${doc.length} chars`);

    // Step 7: Spawn an instance of the Blueprint in the level
    log("actor_spawn Blueprint instance");
    const spawnResult = await callTool("actor_spawn", {
      asset_path: createData.path as string,
      location: { x: 0, y: 500, z: 100 },
      name: TEST_ACTOR,
      folder: "MCPBridge_Test",
    });
    assert(spawnResult.success === true, `Spawn failed: ${spawnResult.error}`);

    // Step 8: Focus on the spawned instance
    log("viewport_focus on Blueprint instance");
    const focusResult = await callTool("viewport_focus", {
      actor_name: TEST_ACTOR,
      distance: 500,
    });
    assert(focusResult.success === true, `viewport_focus failed: ${focusResult.error}`);

    // Step 9: Screenshot
    log("viewport_screenshot");
    const ssResult = await callTool("viewport_screenshot", {
      filename: "blueprint_integration_test.png",
    });
    assert(ssResult.success === true, `viewport_screenshot failed: ${ssResult.error}`);
    const ssData = ssResult.data as Record<string, unknown>;
    console.log(`       Screenshot: ${ssData.filepath}`);

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
