/**
 * Integration test: Actor workflow against a live UE4 instance.
 *
 * Prerequisites:
 *   1. UE4.27 editor is running with the MCP Bridge listener active
 *   2. The project has a /Game/StarterContent/Shapes/Shape_Cube asset
 *      (or adjust CUBE_ASSET below)
 *
 * Run: npx tsx tests/integration/test-actor-workflow.ts
 *
 * Sequence:
 *   test_connection -> actor_spawn (cube) -> level_actors (verify) ->
 *   actor_modify (move) -> level_actors (verify position) ->
 *   actor_duplicate (with offset) -> actor_organize (folder) ->
 *   actor_delete (cleanup) -> level_actors (verify gone)
 */

import { UnrealClient } from "../../mcp-server/src/unreal-client.js";

const CUBE_ASSET = "/Game/StarterContent/Shapes/Shape_Cube";
const TEST_LABEL = "IntegrationTest_Cube";
const TEST_COPY_LABEL = "IntegrationTest_Cube_Copy";
const TEST_FOLDER = "IntegrationTests";

const client = new UnrealClient({ timeout: 15000 });

let stepNum = 0;
let passed = 0;
let failed = 0;

async function step(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  stepNum++;
  const label = `Step ${stepNum}: ${name}`;
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        ${(err as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function send(
  command: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const result = await client.sendCommand(command, params);
  return result as unknown as Record<string, unknown>;
}

// ---- Test Steps ----

async function run(): Promise<void> {
  console.log("Integration test: Actor workflow\n");
  console.log(`Using asset: ${CUBE_ASSET}`);
  console.log(`Test actor label: ${TEST_LABEL}\n`);

  // 1. Connection check
  await step("test_connection", async () => {
    const result = await send("test_connection");
    assert(result.success === true, `Connection failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    assert(data.status === "connected", `Unexpected status: ${data.status}`);
    console.log(`        Engine: ${data.engine_version}, Project: ${data.project}`);
  });

  // 2. Spawn a cube
  await step("actor_spawn (cube)", async () => {
    const result = await send("actor_spawn", {
      asset_path: CUBE_ASSET,
      location: { x: 0, y: 0, z: 100 },
      rotation: { pitch: 0, yaw: 45, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
      name: TEST_LABEL,
      validate: true,
    });
    assert(result.success === true, `Spawn failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    assert(data.name === TEST_LABEL, `Expected name '${TEST_LABEL}', got '${data.name}'`);

    // Check validation result
    const validation = data.validation as Record<string, unknown> | undefined;
    if (validation) {
      assert(validation.valid === true, `Validation failed: ${JSON.stringify(validation.errors)}`);
      console.log("        Validation: passed");
    }
  });

  // 3. Verify cube appears in level_actors
  await step("level_actors (verify spawn)", async () => {
    const result = await send("level_actors");
    assert(result.success === true, `level_actors failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    const actors = data.actors as Array<Record<string, unknown>>;
    const found = actors.find((a) => a.name === TEST_LABEL);
    assert(found !== undefined, `Actor '${TEST_LABEL}' not found in level`);
    console.log(`        Found ${TEST_LABEL} among ${data.count} actors`);
  });

  // 4. Modify: move the cube
  const newLocation = { x: 500, y: 300, z: 200 };
  await step("actor_modify (move)", async () => {
    const result = await send("actor_modify", {
      actor_name: TEST_LABEL,
      location: newLocation,
      validate: true,
    });
    assert(result.success === true, `Modify failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    const modified = data.modified_properties as string[];
    assert(modified.includes("location"), "location not in modified_properties");

    const validation = data.validation as Record<string, unknown> | undefined;
    if (validation) {
      assert(validation.valid === true, `Validation failed: ${JSON.stringify(validation.errors)}`);
      console.log("        Validation: passed");
    }
  });

  // 5. Verify new position
  await step("level_actors (verify new position)", async () => {
    const result = await send("level_actors");
    assert(result.success === true, `level_actors failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    const actors = data.actors as Array<Record<string, unknown>>;
    const found = actors.find((a) => a.name === TEST_LABEL);
    assert(found !== undefined, `Actor '${TEST_LABEL}' not found`);

    const loc = found.location as { x: number; y: number; z: number };
    const tolerance = 1.0;
    assert(
      Math.abs(loc.x - newLocation.x) < tolerance &&
      Math.abs(loc.y - newLocation.y) < tolerance &&
      Math.abs(loc.z - newLocation.z) < tolerance,
      `Location mismatch: expected ~(${newLocation.x},${newLocation.y},${newLocation.z}), got (${loc.x},${loc.y},${loc.z})`
    );
    console.log(`        Position verified: (${loc.x}, ${loc.y}, ${loc.z})`);
  });

  // 6. Duplicate with offset
  await step("actor_duplicate (with offset)", async () => {
    const result = await send("actor_duplicate", {
      actor_name: TEST_LABEL,
      offset: { x: 200, y: 0, z: 0 },
      new_name: TEST_COPY_LABEL,
      validate: true,
    });
    assert(result.success === true, `Duplicate failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    assert(data.name === TEST_COPY_LABEL, `Expected name '${TEST_COPY_LABEL}', got '${data.name}'`);

    const loc = data.location as { x: number; y: number; z: number };
    const expectedX = newLocation.x + 200;
    assert(
      Math.abs(loc.x - expectedX) < 1.0,
      `Copy X should be ~${expectedX}, got ${loc.x}`
    );
    console.log(`        Copy at: (${loc.x}, ${loc.y}, ${loc.z})`);
  });

  // 7. Organize both into a folder
  await step("actor_organize (folder)", async () => {
    const result = await send("actor_organize", {
      actors: [TEST_LABEL, TEST_COPY_LABEL],
      folder: TEST_FOLDER,
    });
    assert(result.success === true, `Organize failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    const moved = data.moved as string[];
    assert(moved.length === 2, `Expected 2 moved, got ${moved.length}`);
    assert(data.folder === TEST_FOLDER, `Folder mismatch`);
    console.log(`        Moved ${moved.length} actors to '${TEST_FOLDER}'`);
  });

  // 8. Delete both test actors
  await step("actor_delete (cleanup)", async () => {
    const result = await send("actor_delete", {
      actor_name: "IntegrationTest_*",
    });
    assert(result.success === true, `Delete failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    assert(
      (data.deleted_count as number) >= 2,
      `Expected at least 2 deleted, got ${data.deleted_count}`
    );
    console.log(`        Deleted ${data.deleted_count} actors`);
  });

  // 9. Verify deletion
  await step("level_actors (verify deletion)", async () => {
    const result = await send("level_actors");
    assert(result.success === true, `level_actors failed: ${result.error}`);
    const data = result.data as Record<string, unknown>;
    const actors = data.actors as Array<Record<string, unknown>>;
    const remaining = actors.filter(
      (a) => (a.name as string).startsWith("IntegrationTest_")
    );
    assert(
      remaining.length === 0,
      `Expected 0 test actors remaining, found ${remaining.length}: ${remaining.map((a) => a.name).join(", ")}`
    );
    console.log("        All test actors cleaned up");
  });

  // Summary
  console.log(`\n${passed + failed} steps: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Integration test crashed:", err);
  process.exit(1);
});
