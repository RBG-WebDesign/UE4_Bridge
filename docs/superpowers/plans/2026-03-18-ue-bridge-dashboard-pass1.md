# UE Bridge Dashboard Pass 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the dashboard plugin polling `/status` from the Python listener and showing live connection state in a dockable tab.

**Architecture:** Python listener gets `/ping` and `/status` GET endpoints that return bridge state as JSON. C++ plugin (`UEBridgeDashboard`) has `FBridgeStatusService` that polls `/status` every 1s via `FHttpModule`, updates `FBridgeState` struct. Module registers a `NomadTab` that reads state and shows "Connected" / "Disconnected" text.

**Tech Stack:** UE4.27 C++ (Slate, FHttpModule, FTicker, JSON), Python 3.6+ (http.server)

**Spec:** `docs/superpowers/specs/2026-03-18-ue-bridge-dashboard-design.md`

**Important paths:**
- C++ plugin: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\`
- Python listener: `d:\UE\UE_Bridge\unreal-plugin\Content\Python\mcp_bridge\`
- Build command: `& "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex -FromMsBuild`
- Build.bat must be invoked with `&` in PowerShell, not just quoted path.

**Testing strategy:** Python endpoints are testable via unit tests (mock HTTP, no UE4). C++ code requires manual verification in-editor (open tab, check Output Log). There are no C++ unit tests in this project -- verification is manual: compile, open editor, open tab, confirm behavior.

---

### Task 1: Python -- Add status tracking variables to listener.py

**Files:**
- Modify: `d:\UE\UE_Bridge\unreal-plugin\Content\Python\mcp_bridge\listener.py`

- [ ] **Step 1: Add module-level tracking vars after existing globals**

After line 23 (`_tick_handle: Optional[object] = None`), add:

```python
_start_time: float = 0.0
_last_event_timestamp: float = 0.0
_last_event_command: str = ""
_last_event_result: str = ""
_last_event_duration_ms: float = 0.0

# Subsystem detection (cached at startup on game thread)
_blueprint_builder_loaded: bool = False
_blueprint_builder_version: str = ""
_widget_blueprint_builder_loaded: bool = False
_widget_blueprint_builder_version: str = ""
_shaderweave_registered: bool = False
_shaderweave_active_sessions: int = 0
```

- [ ] **Step 2: Add `import time` to imports**

Add `import time` to the imports at the top of the file (after `import threading`).

- [ ] **Step 3: Set `_start_time` in `start()` function**

In the `start()` function, right after `global _server, _server_thread, _tick_handle`, add `global _start_time` and set `_start_time = time.time()` right before `_server = HTTPServer(...)`.

```python
def start(host: str = HOST, port: int = PORT) -> bool:
    global _server, _server_thread, _tick_handle, _start_time

    if _server is not None:
        # ... existing check ...
        return False

    try:
        _start_time = time.time()
        _server = HTTPServer((host, port), BridgeRequestHandler)
```

- [ ] **Step 4: Update `_process_command_queue` to track last event**

In `_process_command_queue`, after `result = route_command(command, params)` (and the except block), add timing and event tracking. The function needs to record when each command started and finished.

Replace the command processing section inside the while loop:

```python
        request_id = item["id"]
        command = item["command"]
        params = item["params"]

        global _last_event_timestamp, _last_event_command, _last_event_result, _last_event_duration_ms
        cmd_start = time.time()

        try:
            result = route_command(command, params)
        except Exception as e:
            result = {
                "success": False,
                "data": {},
                "error": f"Handler error: {str(e)}\n{traceback.format_exc()}"
            }

        cmd_duration = (time.time() - cmd_start) * 1000.0  # ms
        _last_event_timestamp = time.time()
        _last_event_command = command
        _last_event_result = "success" if result.get("success", False) else "error"
        _last_event_duration_ms = cmd_duration
```

- [ ] **Step 5: Add subsystem detection function**

Add a new function `_detect_subsystems()` that runs once on the game thread during startup. Place it after `_process_command_queue`:

```python
def _detect_subsystems() -> None:
    """Detect available subsystems. Runs once on game thread at startup."""
    global _blueprint_builder_loaded, _blueprint_builder_version
    global _widget_blueprint_builder_loaded, _widget_blueprint_builder_version

    try:
        import unreal
        # Check BlueprintGraphBuilder
        # UE4.27 does not have unreal.find_class(). Use getattr to check if the
        # class is exposed to Python via UE4's reflection system.
        try:
            bp_class = getattr(unreal, 'BlueprintGraphBuilderLibrary', None)
            _blueprint_builder_loaded = bp_class is not None
            if _blueprint_builder_loaded:
                _blueprint_builder_version = "0.1.0"
        except Exception:
            _blueprint_builder_loaded = False

        # Check WidgetBlueprintBuilder
        try:
            wb_class = getattr(unreal, 'WidgetBlueprintBuilderLibrary', None)
            _widget_blueprint_builder_loaded = wb_class is not None
            if _widget_blueprint_builder_loaded:
                _widget_blueprint_builder_version = "0.1.0"
        except Exception:
            _widget_blueprint_builder_loaded = False

        unreal.log(f"[MCP Bridge] Subsystem detection: BlueprintBuilder={_blueprint_builder_loaded}, WidgetBuilder={_widget_blueprint_builder_loaded}")
    except ImportError:
        pass
```

- [ ] **Step 6: Call `_detect_subsystems()` from `start()`**

In `start()`, right after `_tick_handle = unreal.register_slate_post_tick_callback(...)`, add:

```python
            _detect_subsystems()
```

- [ ] **Step 7: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/listener.py
git commit -m "feat: add status tracking vars and subsystem detection to listener"
```

---

### Task 2: Python -- Add `/ping` and `/status` GET endpoints

**Files:**
- Modify: `d:\UE\UE_Bridge\unreal-plugin\Content\Python\mcp_bridge\listener.py`

- [ ] **Step 1: Replace `do_GET` with path-routing version**

Replace the existing `do_GET` method in `BridgeRequestHandler`:

```python
    def do_GET(self) -> None:
        """Handle GET requests: /ping, /status, / (health check)."""
        path = self.path.rstrip("/")

        if path == "/ping":
            self._send_json(200, {
                "success": True,
                "data": {"ok": True}
            })
        elif path == "/status":
            self._handle_status()
        else:
            # Backward-compatible health check
            self._send_json(200, {
                "success": True,
                "data": {"status": "ok", "message": "MCP Bridge listener is running"}
            })
```

- [ ] **Step 2: Add `_handle_status` method to `BridgeRequestHandler`**

Add this method to the `BridgeRequestHandler` class, after `do_GET`:

```python
    def _handle_status(self) -> None:
        """Return full bridge status. Reads thread-safe module-level vars only."""
        uptime = time.time() - _start_time if _start_time > 0 else 0.0

        last_event = None
        if _last_event_timestamp > 0:
            last_event = {
                "timestamp": _last_event_timestamp,
                "command": _last_event_command,
                "result": _last_event_result,
                "duration_ms": round(_last_event_duration_ms, 1),
            }

        self._send_json(200, {
            "success": True,
            "data": {
                "version": "0.1.0",
                "protocol_version": 1,
                "bridge": {
                    "running": True,
                    "port": PORT,
                    "uptime_sec": round(uptime, 1),
                    "total_requests": _request_counter,
                    "server_time": time.time(),
                },
                "last_event": last_event,
                "subsystems": {
                    "blueprint_builder": {
                        "loaded": _blueprint_builder_loaded,
                        "version": _blueprint_builder_version,
                    },
                    "widget_blueprint_builder": {
                        "loaded": _widget_blueprint_builder_loaded,
                        "version": _widget_blueprint_builder_version,
                    },
                    "shaderweave": {
                        "registered": _shaderweave_registered,
                        "active_sessions": _shaderweave_active_sessions,
                    },
                },
            }
        })
```

- [ ] **Step 3: Verify manually**

Start UE4 with the listener, then from a terminal:

```bash
curl http://localhost:8080/ping
# Expected: {"success": true, "data": {"ok": true}}

curl http://localhost:8080/status
# Expected: full JSON with bridge, subsystems, etc.

curl http://localhost:8080/
# Expected: original health check (backward compatible)
```

- [ ] **Step 4: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/listener.py
git commit -m "feat: add /ping and /status GET endpoints to listener"
```

---

### Task 3: Python -- Add unit test for /status endpoint

**Files:**
- Create: `d:\UE\UE_Bridge\mcp-server\tests\status-endpoint.test.ts`
- Modify: `d:\UE\UE_Bridge\mcp-server\tests\mock-server.ts` (if needed)

The existing test infrastructure uses a mock HTTP server. We can test that the MCP server's client can call `/status` by adding a mock handler. However, the `/status` endpoint lives on the Python side and the mock server simulates Python responses. We need to verify the response shape is parseable.

- [ ] **Step 1: Check if mock-server supports GET requests**

Read `mcp-server/tests/mock-server.ts` to understand its capabilities. If it only handles POST, we may need to add GET support or test via integration tests instead.

- [ ] **Step 2: Write a test that verifies the /status JSON contract**

Create a simple test that starts a local HTTP server, returns the expected `/status` JSON, and verifies the shape is correct. This validates the contract without needing UE4.

```typescript
/**
 * Unit test for /status endpoint contract.
 * Verifies the JSON shape matches what FBridgeStatusService expects.
 *
 * Run: npx tsx mcp-server/tests/status-endpoint.test.ts
 */

import http from "http";

// ---- Test runner ----
interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---- Mock status server ----

const STATUS_RESPONSE = {
  success: true,
  data: {
    version: "0.1.0",
    protocol_version: 1,
    bridge: {
      running: true,
      port: 8080,
      uptime_sec: 123.4,
      total_requests: 42,
      server_time: Date.now() / 1000,
    },
    last_event: {
      timestamp: Date.now() / 1000 - 1,
      command: "actor_spawn",
      result: "success",
      duration_ms: 55.2,
    },
    subsystems: {
      blueprint_builder: { loaded: true, version: "0.1.0" },
      widget_blueprint_builder: { loaded: false, version: "" },
      shaderweave: { registered: false, active_sessions: 0 },
    },
  },
};

const PING_RESPONSE = {
  success: true,
  data: { ok: true },
};

let mockServer: http.Server;
const MOCK_PORT = 18790;

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const path = (req.url || "/").replace(/\/+$/, "") || "/";
      let body: object;

      if (req.method === "GET" && path === "/ping") {
        body = PING_RESPONSE;
      } else if (req.method === "GET" && path === "/status") {
        body = STATUS_RESPONSE;
      } else if (req.method === "GET") {
        body = { success: true, data: { status: "ok", message: "MCP Bridge listener is running" } };
      } else {
        body = { success: false, data: {}, error: "Unknown" };
      }

      const json = JSON.stringify(body);
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(json.length) });
      res.end(json);
    });
    mockServer.listen(MOCK_PORT, "localhost", () => resolve());
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer.close(() => resolve());
  });
}

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${MOCK_PORT}${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
  });
}

// ---- Tests ----

test("GET /ping returns {success: true, data: {ok: true}}", async () => {
  const res = await httpGet("/ping");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assertEqual(json.data.ok, true, "data.ok");
});

test("GET /status returns standard {success, data} shape", async () => {
  const res = await httpGet("/status");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assert(json.data !== undefined, "data field exists");
  assert(json.data.version !== undefined, "data.version exists");
  assert(json.data.protocol_version !== undefined, "data.protocol_version exists");
  assert(json.data.bridge !== undefined, "data.bridge exists");
  assert(json.data.subsystems !== undefined, "data.subsystems exists");
});

test("GET /status bridge section has required fields", async () => {
  const res = await httpGet("/status");
  const bridge = JSON.parse(res.body).data.bridge;
  assertEqual(typeof bridge.running, "boolean", "bridge.running type");
  assertEqual(typeof bridge.port, "number", "bridge.port type");
  assertEqual(typeof bridge.uptime_sec, "number", "bridge.uptime_sec type");
  assertEqual(typeof bridge.total_requests, "number", "bridge.total_requests type");
  assertEqual(typeof bridge.server_time, "number", "bridge.server_time type");
});

test("GET /status subsystems section has required fields", async () => {
  const res = await httpGet("/status");
  const subs = JSON.parse(res.body).data.subsystems;

  assert(subs.blueprint_builder !== undefined, "blueprint_builder exists");
  assertEqual(typeof subs.blueprint_builder.loaded, "boolean", "blueprint_builder.loaded type");

  assert(subs.widget_blueprint_builder !== undefined, "widget_blueprint_builder exists");
  assertEqual(typeof subs.widget_blueprint_builder.loaded, "boolean", "widget_blueprint_builder.loaded type");

  assert(subs.shaderweave !== undefined, "shaderweave exists");
  assertEqual(typeof subs.shaderweave.registered, "boolean", "shaderweave.registered type");
  assertEqual(typeof subs.shaderweave.active_sessions, "number", "shaderweave.active_sessions type");
});

test("GET /status last_event can be null (no commands processed yet)", async () => {
  // This test uses a modified response
  const origEvent = STATUS_RESPONSE.data.last_event;
  (STATUS_RESPONSE.data as any).last_event = null;

  const res = await httpGet("/status");
  const json = JSON.parse(res.body);
  assertEqual(json.data.last_event, null, "last_event is null");

  // Restore
  (STATUS_RESPONSE.data as any).last_event = origEvent;
});

test("GET / returns backward-compatible health check", async () => {
  const res = await httpGet("/");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assertEqual(json.data.status, "ok", "data.status");
});

// ---- Runner ----

async function run(): Promise<void> {
  await startMockServer();
  console.log(`\nStatus endpoint tests (mock on port ${MOCK_PORT})\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err: any) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
    }
  }

  await stopMockServer();

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  if (failed > 0) process.exit(1);
}

run();
```

- [ ] **Step 3: Run the test**

```bash
cd d:/UE/UE_Bridge
npx tsx mcp-server/tests/status-endpoint.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 4: Commit**

```bash
cd d:/UE/UE_Bridge
git add mcp-server/tests/status-endpoint.test.ts
git commit -m "test: add unit tests for /status endpoint contract"
```

---

### Task 4: C++ -- Update uplugin and Build.cs

**Files:**
- Modify: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\UEBridgeDashboard.uplugin`
- Modify: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\UEBridgeDashboard.Build.cs`

- [ ] **Step 1: Update uplugin -- change module type and loading phase**

Replace the `"Modules"` array in `UEBridgeDashboard.uplugin`:

```json
{
	"FileVersion": 3,
	"Version": 1,
	"VersionName": "1.0",
	"FriendlyName": "UE Bridge Dashboard",
	"Description": "Status dashboard for the UE Bridge system. Shows connection state, subsystem health, and activity log.",
	"Category": "Editor",
	"CreatedBy": "",
	"CreatedByURL": "",
	"DocsURL": "",
	"MarketplaceURL": "",
	"SupportURL": "",
	"CanContainContent": false,
	"IsBetaVersion": true,
	"IsExperimentalVersion": false,
	"Installed": false,
	"Modules": [
		{
			"Name": "UEBridgeDashboard",
			"Type": "Editor",
			"LoadingPhase": "PostEngineInit"
		}
	]
}
```

Key changes: `Type` from `"Runtime"` to `"Editor"`, `LoadingPhase` from `"Default"` to `"PostEngineInit"`, `CanContainContent` from `true` to `false`.

- [ ] **Step 2: Update Build.cs -- add dependencies**

Replace the full `Build.cs` content:

```csharp
using UnrealBuildTool;

public class UEBridgeDashboard : ModuleRules
{
	public UEBridgeDashboard(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
			}
		);

		PrivateDependencyModuleNames.AddRange(
			new string[]
			{
				"CoreUObject",
				"Engine",
				"Slate",
				"SlateCore",
				"HTTP",
				"Json",
				"JsonUtilities",
				"LevelEditor",
				"EditorStyle",
				"InputCore",
				"UnrealEd",
			}
		);
	}
}
```

- [ ] **Step 3: Compile to verify dependencies resolve**

```powershell
& "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex -FromMsBuild
```

Expected: compiles with no errors. The module loads but still has the empty StartupModule.

- [ ] **Step 4: Commit**

```bash
cd "D:/Unreal Projects/CodePlayground"
git add Plugins/UEBridgeDashboard/UEBridgeDashboard.uplugin
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/UEBridgeDashboard.Build.cs
git commit -m "feat: update UEBridgeDashboard uplugin and Build.cs dependencies"
```

---

### Task 5: C++ -- Create BridgeState.h (data structs)

**Files:**
- Create: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\Public\BridgeState.h`

- [ ] **Step 1: Write BridgeState.h**

```cpp
// BridgeState.h -- Plain data structs for bridge status. No logic, no UE macros.

#pragma once

#include "CoreMinimal.h"

/**
 * Single entry in the activity log ring buffer.
 */
struct FBridgeLogEntry
{
	FDateTime Timestamp;
	FString Command;
	FString Result;
	float DurationMs = 0.f;
};

/**
 * Snapshot of the bridge system state, updated by FBridgeStatusService.
 * UI reads this struct -- never writes to it.
 */
struct FBridgeState
{
	// Connection (two signals -- see spec for three UI states)
	bool bHttpReachable = false;
	bool bStatusValid = false;
	int32 Port = 8080;
	float UptimeSec = 0.f;
	double LastSuccessTime = 0.0;
	FString BridgeVersion;

	// Last event (from /status last_event block)
	double LastEventTimestamp = 0.0;
	FString LastCommand;
	FString LastResult;
	float LastDurationMs = 0.f;

	// Activity
	int32 TotalRequests = 0;

	// Subsystems
	bool bBlueprintBuilderLoaded = false;
	FString BlueprintBuilderVersion;
	bool bWidgetBlueprintBuilderLoaded = false;
	FString WidgetBlueprintBuilderVersion;
	bool bShaderWeaveRegistered = false;
	int32 ShaderWeaveActiveSessions = 0;

	// Diagnostics
	int32 ConsecutiveFailures = 0;
	FString LastError;
};
```

- [ ] **Step 2: Compile**

Same build command as Task 4 Step 3. Header-only, so this just verifies no syntax errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Unreal Projects/CodePlayground"
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Public/BridgeState.h
git commit -m "feat: add FBridgeState and FBridgeLogEntry structs"
```

---

### Task 6: C++ -- Create BridgeStatusService (header)

**Files:**
- Create: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\Public\BridgeStatusService.h`

- [ ] **Step 1: Write BridgeStatusService.h**

```cpp
// BridgeStatusService.h -- Polls /status endpoint, updates FBridgeState.

#pragma once

#include "CoreMinimal.h"
#include "BridgeState.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Containers/Ticker.h"

/**
 * Polls the Python listener's /status endpoint and maintains FBridgeState.
 * UI reads GetState() -- never touches HTTP directly.
 */
class FBridgeStatusService
{
public:
	FBridgeStatusService();
	~FBridgeStatusService();

	/** Start polling at 1s intervals. */
	void StartPolling();

	/** Stop polling and cancel any in-flight request. */
	void StopPolling();

	/** Force an immediate /status poll (used by Reconnect/Test buttons). */
	void ForcePoll();

	/** Cancel active request, reset failure count, force poll (used by Reconnect). */
	void Reconnect();

	/** Send restart_listener command, immediately mark disconnected. */
	void RestartListener();

	/** Clear the activity log ring buffer. */
	void ClearLog();

	/** Read-only access to current state. */
	const FBridgeState& GetState() const { return CurrentState; }

	/** Read-only access to activity log entries. */
	const TArray<TSharedPtr<FBridgeLogEntry>>& GetLogEntries() const { return LogEntries; }

private:
	bool Tick(float DeltaTime);
	void SendStatusRequest();
	void OnStatusResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnectedSuccessfully);
	void CancelActiveRequest();
	void ParseStatusJson(TSharedPtr<class FJsonObject> DataObj);
	void PushLogEntry(const FString& Command, const FString& Result, float DurationMs);

	FBridgeState CurrentState;
	TArray<TSharedPtr<FBridgeLogEntry>> LogEntries;

	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> ActiveRequest;
	FDelegateHandle TickerHandle;
	bool bRequestInFlight = false;
	bool bFirstSuccessLogged = false;
	double RequestStartTime = 0.0;

	float PollInterval = 1.0f;
	float TimeSinceLastPoll = 0.f;

	static constexpr int32 MaxLogEntries = 50;
	static constexpr float DefaultPollInterval = 1.0f;
	static constexpr float BackoffPollInterval = 5.0f;
	static constexpr int32 BackoffThreshold = 3;
	static constexpr float HttpTimeout = 2.0f;
};
```

- [ ] **Step 2: Compile**

Same build command. Header-only -- verifies includes resolve.

- [ ] **Step 3: Commit**

```bash
cd "D:/Unreal Projects/CodePlayground"
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Public/BridgeStatusService.h
git commit -m "feat: add FBridgeStatusService header"
```

---

### Task 7: C++ -- Implement BridgeStatusService.cpp

**Files:**
- Create: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\Private\BridgeStatusService.cpp`

- [ ] **Step 1: Write BridgeStatusService.cpp**

```cpp
// BridgeStatusService.cpp -- HTTP polling, JSON parsing, state updates.

#include "BridgeStatusService.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

FBridgeStatusService::FBridgeStatusService()
{
}

FBridgeStatusService::~FBridgeStatusService()
{
	StopPolling();
}

void FBridgeStatusService::StartPolling()
{
	if (TickerHandle.IsValid())
	{
		return; // Already polling
	}

	TickerHandle = FTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateRaw(this, &FBridgeStatusService::Tick),
		0.1f // Tick every 100ms, we control poll interval internally
	);

	UE_LOG(LogTemp, Log, TEXT("[UEBridgeDashboard] Polling started (interval: %.1fs)"), PollInterval);
}

void FBridgeStatusService::StopPolling()
{
	if (TickerHandle.IsValid())
	{
		FTicker::GetCoreTicker().RemoveTicker(TickerHandle);
		TickerHandle.Reset();
	}
	CancelActiveRequest();
	UE_LOG(LogTemp, Log, TEXT("[UEBridgeDashboard] Polling stopped"));
}

void FBridgeStatusService::ForcePoll()
{
	CancelActiveRequest();
	TimeSinceLastPoll = PollInterval; // Force next tick to send
}

void FBridgeStatusService::Reconnect()
{
	CancelActiveRequest();
	CurrentState.ConsecutiveFailures = 0;
	PollInterval = DefaultPollInterval;
	TimeSinceLastPoll = PollInterval; // Force immediate poll
}

void FBridgeStatusService::RestartListener()
{
	// Send restart command -- response will likely be lost
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(FString::Printf(TEXT("http://localhost:%d/"), CurrentState.Port));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(TEXT("{\"command\":\"restart_listener\",\"params\":{}}"));
	// No SetTimeout in UE4.27 -- fire and forget, don't track this request
	Request->ProcessRequest();

	// Immediately mark disconnected
	CurrentState.bHttpReachable = false;
	CurrentState.bStatusValid = false;
	CurrentState.LastError = TEXT("Restarting listener...");
}

void FBridgeStatusService::ClearLog()
{
	LogEntries.Empty();
}

bool FBridgeStatusService::Tick(float DeltaTime)
{
	// Manual timeout check (UE4.27 IHttpRequest has no SetTimeout)
	if (bRequestInFlight && ActiveRequest.IsValid())
	{
		double Elapsed = FPlatformTime::Seconds() - RequestStartTime;
		if (Elapsed >= HttpTimeout)
		{
			ActiveRequest->CancelRequest();
			// OnStatusResponse will fire with bConnectedSuccessfully=false
		}
	}

	TimeSinceLastPoll += DeltaTime;

	if (TimeSinceLastPoll >= PollInterval && !bRequestInFlight)
	{
		TimeSinceLastPoll = 0.f;
		SendStatusRequest();
	}

	return true; // Keep ticking
}

void FBridgeStatusService::SendStatusRequest()
{
	CancelActiveRequest();

	ActiveRequest = FHttpModule::Get().CreateRequest();
	ActiveRequest->SetURL(FString::Printf(TEXT("http://localhost:%d/status"), CurrentState.Port));
	ActiveRequest->SetVerb(TEXT("GET"));
	// UE4.27 IHttpRequest does not have SetTimeout(). We track request age
	// in Tick() and call CancelRequest() manually after HttpTimeout seconds.
	ActiveRequest->OnProcessRequestComplete().BindRaw(this, &FBridgeStatusService::OnStatusResponse);

	bRequestInFlight = true;
	RequestStartTime = FPlatformTime::Seconds();
	ActiveRequest->ProcessRequest();
}

void FBridgeStatusService::OnStatusResponse(
	FHttpRequestPtr Request,
	FHttpResponsePtr Response,
	bool bConnectedSuccessfully)
{
	bRequestInFlight = false;
	ActiveRequest.Reset();

	// HTTP failure (connection refused, timeout, etc.)
	if (!bConnectedSuccessfully || !Response.IsValid())
	{
		CurrentState.bHttpReachable = false;
		CurrentState.bStatusValid = false;
		CurrentState.ConsecutiveFailures++;
		CurrentState.LastError = TEXT("Connection failed");

		if (CurrentState.ConsecutiveFailures >= BackoffThreshold)
		{
			PollInterval = BackoffPollInterval;
		}
		return;
	}

	// HTTP succeeded
	CurrentState.bHttpReachable = true;

	// Parse JSON
	FString ResponseBody = Response->GetContentAsString();
	TSharedPtr<FJsonObject> RootObj;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ResponseBody);

	if (!FJsonSerializer::Deserialize(Reader, RootObj) || !RootObj.IsValid())
	{
		CurrentState.bStatusValid = false;
		CurrentState.ConsecutiveFailures++;
		CurrentState.LastError = TEXT("Invalid JSON response");
		return;
	}

	// Check standard {success, data} shape
	bool bSuccess = RootObj->GetBoolField(TEXT("success"));
	const TSharedPtr<FJsonObject>* DataObjPtr = nullptr;

	if (!bSuccess || !RootObj->TryGetObjectField(TEXT("data"), DataObjPtr) || !DataObjPtr)
	{
		CurrentState.bStatusValid = false;
		CurrentState.ConsecutiveFailures++;
		CurrentState.LastError = TEXT("Status response: success=false or missing data");
		return;
	}

	// Valid response -- parse fields
	ParseStatusJson(*DataObjPtr);

	CurrentState.bStatusValid = true;
	CurrentState.ConsecutiveFailures = 0;
	CurrentState.LastSuccessTime = FPlatformTime::Seconds();
	CurrentState.LastError = TEXT("");
	PollInterval = DefaultPollInterval;

	// Log first successful parse to Output Log
	if (!bFirstSuccessLogged)
	{
		bFirstSuccessLogged = true;
		UE_LOG(LogTemp, Log, TEXT("[UEBridgeDashboard] First /status response: %s"), *ResponseBody);
	}
}

void FBridgeStatusService::ParseStatusJson(TSharedPtr<FJsonObject> DataObj)
{
	// Version
	// UE4.27: TryGetStringField returns FString (not bool), use HasField + GetStringField
	if (DataObj->HasField(TEXT("version")))
	{
		CurrentState.BridgeVersion = DataObj->GetStringField(TEXT("version"));
	}

	// Bridge section
	const TSharedPtr<FJsonObject>* BridgeObjPtr = nullptr;
	if (DataObj->TryGetObjectField(TEXT("bridge"), BridgeObjPtr) && BridgeObjPtr)
	{
		TSharedPtr<FJsonObject> BridgeObj = *BridgeObjPtr;
		CurrentState.Port = static_cast<int32>(BridgeObj->GetNumberField(TEXT("port")));
		CurrentState.UptimeSec = static_cast<float>(BridgeObj->GetNumberField(TEXT("uptime_sec")));
		CurrentState.TotalRequests = static_cast<int32>(BridgeObj->GetNumberField(TEXT("total_requests")));
	}

	// Last event section (can be null if no commands processed yet)
	const TSharedPtr<FJsonObject>* EventObjPtr = nullptr;
	if (DataObj->TryGetObjectField(TEXT("last_event"), EventObjPtr) && EventObjPtr)
	{
		TSharedPtr<FJsonObject> EventObj = *EventObjPtr;
		double NewTimestamp = EventObj->GetNumberField(TEXT("timestamp"));
		FString Command = EventObj->GetStringField(TEXT("command"));
		FString Result = EventObj->GetStringField(TEXT("result"));
		float DurationMs = static_cast<float>(EventObj->GetNumberField(TEXT("duration_ms")));

		// Push to log if timestamp changed
		if (NewTimestamp != CurrentState.LastEventTimestamp && NewTimestamp > 0)
		{
			PushLogEntry(Command, Result, DurationMs);
		}

		CurrentState.LastEventTimestamp = NewTimestamp;
		CurrentState.LastCommand = Command;
		CurrentState.LastResult = Result;
		CurrentState.LastDurationMs = DurationMs;
	}

	// Subsystems
	const TSharedPtr<FJsonObject>* SubsObjPtr = nullptr;
	if (DataObj->TryGetObjectField(TEXT("subsystems"), SubsObjPtr) && SubsObjPtr)
	{
		TSharedPtr<FJsonObject> SubsObj = *SubsObjPtr;

		// Blueprint Builder
		const TSharedPtr<FJsonObject>* BpObjPtr = nullptr;
		if (SubsObj->TryGetObjectField(TEXT("blueprint_builder"), BpObjPtr) && BpObjPtr)
		{
			CurrentState.bBlueprintBuilderLoaded = (*BpObjPtr)->GetBoolField(TEXT("loaded"));
			if ((*BpObjPtr)->HasField(TEXT("version")))
			{
				CurrentState.BlueprintBuilderVersion = (*BpObjPtr)->GetStringField(TEXT("version"));
			}
		}

		// Widget Blueprint Builder
		const TSharedPtr<FJsonObject>* WbObjPtr = nullptr;
		if (SubsObj->TryGetObjectField(TEXT("widget_blueprint_builder"), WbObjPtr) && WbObjPtr)
		{
			CurrentState.bWidgetBlueprintBuilderLoaded = (*WbObjPtr)->GetBoolField(TEXT("loaded"));
			if ((*WbObjPtr)->HasField(TEXT("version")))
			{
				CurrentState.WidgetBlueprintBuilderVersion = (*WbObjPtr)->GetStringField(TEXT("version"));
			}
		}

		// ShaderWeave
		const TSharedPtr<FJsonObject>* SwObjPtr = nullptr;
		if (SubsObj->TryGetObjectField(TEXT("shaderweave"), SwObjPtr) && SwObjPtr)
		{
			CurrentState.bShaderWeaveRegistered = (*SwObjPtr)->GetBoolField(TEXT("registered"));
			CurrentState.ShaderWeaveActiveSessions = static_cast<int32>((*SwObjPtr)->GetNumberField(TEXT("active_sessions")));
		}
	}
}

void FBridgeStatusService::PushLogEntry(const FString& Command, const FString& Result, float DurationMs)
{
	TSharedPtr<FBridgeLogEntry> Entry = MakeShared<FBridgeLogEntry>();
	Entry->Timestamp = FDateTime::Now();
	Entry->Command = Command;
	Entry->Result = Result;
	Entry->DurationMs = DurationMs;

	// Insert at front (newest first)
	LogEntries.Insert(Entry, 0);

	// Trim to max size
	if (LogEntries.Num() > MaxLogEntries)
	{
		LogEntries.SetNum(MaxLogEntries);
	}
}
```

- [ ] **Step 2: Compile**

Same build command. This is the biggest compilation step -- exercises HTTP, JSON, and Ticker includes.

Expected: compiles with no errors. No runtime verification yet (service isn't instantiated).

- [ ] **Step 3: Commit**

```bash
cd "D:/Unreal Projects/CodePlayground"
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Private/BridgeStatusService.cpp
git commit -m "feat: implement FBridgeStatusService HTTP polling and JSON parsing"
```

---

### Task 8: C++ -- Update module to register tab and start polling

**Files:**
- Modify: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\Public\UEBridgeDashboard.h`
- Modify: `D:\Unreal Projects\CodePlayground\Plugins\UEBridgeDashboard\Source\UEBridgeDashboard\Private\UEBridgeDashboard.cpp`

- [ ] **Step 1: Update header to declare tab spawner and service**

Replace the full content of `UEBridgeDashboard.h`:

```cpp
// UEBridgeDashboard.h -- Module interface. Owns the status service and tab registration.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FBridgeStatusService;

class FUEBridgeDashboardModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	/** Get the status service (for UI to read state). */
	FBridgeStatusService* GetStatusService() const { return StatusService.Get(); }

	/** Static accessor for the module instance. */
	static FUEBridgeDashboardModule& Get()
	{
		return FModuleManager::LoadModuleChecked<FUEBridgeDashboardModule>("UEBridgeDashboard");
	}

private:
	TSharedRef<class SDockTab> OnSpawnDashboardTab(const class FSpawnTabArgs& SpawnTabArgs);

	TUniquePtr<FBridgeStatusService> StatusService;
};
```

- [ ] **Step 2: Update cpp to create service, register tab, start polling**

Replace the full content of `UEBridgeDashboard.cpp`:

```cpp
// UEBridgeDashboard.cpp -- Module startup: register tab, create service, start polling.

#include "UEBridgeDashboard.h"
#include "BridgeStatusService.h"
#include "BridgeState.h"
#include "LevelEditor.h"
#include "Widgets/Docking/SDockTab.h"
#include "Widgets/Text/STextBlock.h"
#include "Framework/Docking/TabManager.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"

#define LOCTEXT_NAMESPACE "FUEBridgeDashboardModule"

static const FName BridgeDashboardTabName("UEBridgeDashboard");

void FUEBridgeDashboardModule::StartupModule()
{
	// Register the dashboard tab
	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
		BridgeDashboardTabName,
		FOnSpawnTab::CreateRaw(this, &FUEBridgeDashboardModule::OnSpawnDashboardTab)
	)
	.SetDisplayName(LOCTEXT("DashboardTabTitle", "UE Bridge Dashboard"))
	.SetGroup(WorkspaceMenu::GetMenuStructure().GetDeveloperToolsCategory())
	.SetMenuType(ETabSpawnerMenuType::Enabled);

	// Create and start the status service
	StatusService = MakeUnique<FBridgeStatusService>();
	StatusService->StartPolling();

	UE_LOG(LogTemp, Log, TEXT("[UEBridgeDashboard] Module loaded, polling started"));
}

void FUEBridgeDashboardModule::ShutdownModule()
{
	if (StatusService.IsValid())
	{
		StatusService->StopPolling();
		StatusService.Reset();
	}

	FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(BridgeDashboardTabName);

	UE_LOG(LogTemp, Log, TEXT("[UEBridgeDashboard] Module unloaded"));
}

TSharedRef<SDockTab> FUEBridgeDashboardModule::OnSpawnDashboardTab(const FSpawnTabArgs& SpawnTabArgs)
{
	// Pass 1: simple text showing connection state. Pass 2 replaces with full dashboard.
	return SNew(SDockTab)
		.TabRole(ETabRole::NomadTab)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(10.f)
			[
				SNew(STextBlock)
				.Text_Lambda([this]() -> FText {
					if (!StatusService.IsValid())
					{
						return FText::FromString(TEXT("Service not available"));
					}

					const FBridgeState& State = StatusService->GetState();

					if (State.bHttpReachable && State.bStatusValid)
					{
						float SecAgo = FPlatformTime::Seconds() - State.LastSuccessTime;
						return FText::FromString(FString::Printf(
							TEXT("Bridge: Connected (localhost:%d) | Uptime: %.0fs | Requests: %d | Last seen: %.1fs ago"),
							State.Port, State.UptimeSec, State.TotalRequests, SecAgo
						));
					}
					else if (State.bHttpReachable && !State.bStatusValid)
					{
						return FText::FromString(FString::Printf(
							TEXT("Bridge: Degraded (reachable but invalid response) | Error: %s"),
							*State.LastError
						));
					}
					else
					{
						FString LastSeen;
						if (State.LastSuccessTime > 0.0)
						{
							float SecAgo = FPlatformTime::Seconds() - State.LastSuccessTime;
							LastSeen = FString::Printf(TEXT("%.1fs ago"), SecAgo);
						}
						else
						{
							LastSeen = TEXT("Never");
						}
						return FText::FromString(FString::Printf(
							TEXT("Bridge: Disconnected | Last seen: %s | Failures: %d"),
							*LastSeen, State.ConsecutiveFailures
						));
					}
				})
				.Font(FCoreStyle::GetDefaultFontStyle("Bold", 14))
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(10.f)
			[
				SNew(STextBlock)
				.Text_Lambda([this]() -> FText {
					if (!StatusService.IsValid())
					{
						return FText::GetEmpty();
					}

					const FBridgeState& State = StatusService->GetState();
					return FText::FromString(FString::Printf(
						TEXT("BlueprintBuilder: %s | WidgetBuilder: %s | ShaderWeave: %s"),
						State.bBlueprintBuilderLoaded ? TEXT("Loaded") : TEXT("Not found"),
						State.bWidgetBlueprintBuilderLoaded ? TEXT("Loaded") : TEXT("Not found"),
						State.bShaderWeaveRegistered ? TEXT("Registered") : TEXT("Not registered")
					));
				})
			]
		];
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FUEBridgeDashboardModule, UEBridgeDashboard)
```

- [ ] **Step 3: Compile**

Same build command. This wires everything together.

- [ ] **Step 4: Manual verification in editor**

1. Open UE4 editor (CodePlayground project)
2. Go to Window menu, find "UE Bridge Dashboard"
3. Click to open the tab
4. If the Python listener is running: should show "Bridge: Connected (localhost:8080) | Uptime: Xs | Requests: N | Last seen: 0.Xs ago"
5. If the Python listener is NOT running: should show "Bridge: Disconnected | Last seen: Never | Failures: N" (failure count incrementing)
6. Check Output Log for "[UEBridgeDashboard] First /status response: ..." on first successful poll
7. Dock the tab somewhere to verify it persists

- [ ] **Step 5: Commit**

```bash
cd "D:/Unreal Projects/CodePlayground"
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Public/UEBridgeDashboard.h
git add Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Private/UEBridgeDashboard.cpp
git commit -m "feat: wire module to register dashboard tab and start polling"
```

---

### Task 9: Copy plugin source to UE_Bridge repo

The plugin source should also be tracked in the UE_Bridge repo for version control, even though it compiles inside CodePlayground.

**Files:**
- Create: `d:\UE\UE_Bridge\ue4-plugin\UEBridgeDashboard\` (mirror of source files only, not binaries)

- [ ] **Step 1: Copy source files to UE_Bridge repo**

Copy these files (not binaries or intermediates):
- `UEBridgeDashboard.uplugin`
- `Source/UEBridgeDashboard/UEBridgeDashboard.Build.cs`
- `Source/UEBridgeDashboard/Public/UEBridgeDashboard.h`
- `Source/UEBridgeDashboard/Public/BridgeState.h`
- `Source/UEBridgeDashboard/Public/BridgeStatusService.h`
- `Source/UEBridgeDashboard/Private/UEBridgeDashboard.cpp`
- `Source/UEBridgeDashboard/Private/BridgeStatusService.cpp`

```bash
cd d:/UE/UE_Bridge
mkdir -p ue4-plugin/UEBridgeDashboard/Source/UEBridgeDashboard/Public
mkdir -p ue4-plugin/UEBridgeDashboard/Source/UEBridgeDashboard/Private

cp "D:/Unreal Projects/CodePlayground/Plugins/UEBridgeDashboard/UEBridgeDashboard.uplugin" ue4-plugin/UEBridgeDashboard/
cp "D:/Unreal Projects/CodePlayground/Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/UEBridgeDashboard.Build.cs" ue4-plugin/UEBridgeDashboard/Source/UEBridgeDashboard/
cp "D:/Unreal Projects/CodePlayground/Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Public/"*.h ue4-plugin/UEBridgeDashboard/Source/UEBridgeDashboard/Public/
cp "D:/Unreal Projects/CodePlayground/Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/Private/"*.cpp ue4-plugin/UEBridgeDashboard/Source/UEBridgeDashboard/Private/
```

- [ ] **Step 2: Commit**

```bash
cd d:/UE/UE_Bridge
git add ue4-plugin/UEBridgeDashboard/
git commit -m "feat: add UEBridgeDashboard plugin source to repo"
```

---

## Verification Checklist (Pass 1 complete when ALL pass)

- [ ] `curl http://localhost:8080/ping` returns `{"success": true, "data": {"ok": true}}`
- [ ] `curl http://localhost:8080/status` returns full JSON with bridge, subsystems, last_event sections
- [ ] `curl http://localhost:8080/` still returns the original health check (backward compatible)
- [ ] `npx tsx mcp-server/tests/status-endpoint.test.ts` passes all 6 tests
- [ ] UEBridgeDashboard plugin compiles with no errors
- [ ] Dashboard tab appears in Window menu
- [ ] Tab shows "Connected" when listener is running with live data updating
- [ ] Tab shows "Disconnected" with failure count when listener is not running
- [ ] Output Log shows "[UEBridgeDashboard] First /status response: ..." on first successful poll
- [ ] Tab is dockable (can drag to different locations in editor layout)
