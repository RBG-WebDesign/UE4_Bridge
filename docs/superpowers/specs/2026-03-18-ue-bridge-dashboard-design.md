# UE Bridge Dashboard -- Design Spec

**Date:** 2026-03-18
**Status:** Design complete, implementation not started
**Plugin:** `Plugins/UEBridgeDashboard/` (already created in CodePlayground)

## Problem

The UE Bridge system has zero in-editor visibility. There is no indication that `startup.py` ran, that the listener is alive, or that commands are being processed. Users must trust that everything works or debug via Output Log. With three products sharing one transport layer (Blueprint Builder, Widget Blueprint Builder, ShaderWeave), this opacity becomes untenable for team use or distribution.

## Solution

A C++ editor plugin providing two UI surfaces:

1. **Dockable Slate tab** ("UE Bridge Dashboard") -- full status panel with connection state, subsystem cards, activity log, and quick actions
2. **Status bar indicator** -- always-visible colored dot in the editor's bottom bar, click to open dashboard

The C++ plugin polls the Python listener via HTTP (same transport the MCP server uses). No new protocols, no shared state files, no Python UI code.

## Architecture

```
FBridgeStatusService (C++)
    |
    | GET /status every 1s (FHttpModule)
    v
Python Listener (existing, port 8080)
    |
    | reads thread-safe counters
    v
FBridgeState struct (plain data)
    ^
    | reads only
    |
SBridgeDashboardTab (Slate)
SBridgeStatusIndicator (Slate)
```

### Boundaries

- C++ owns: UI rendering, state model, HTTP polling
- Python owns: `/status` endpoint, counter tracking, subsystem detection
- UI never touches HTTP directly -- reads `FBridgeState` from `FBridgeStatusService`

## Data Contract: `/status` Endpoint

### `GET /ping`

Fast health check. No game-thread work. Used by C++ service for initial connection probe on startup (before full `/status` polling begins).

```json
{"success": true, "data": {"ok": true}}
```

### `GET /status`

Full status payload. Runs on HTTP background thread, reads thread-safe module-level vars.

```json
{
  "success": true,
  "data": {
    "version": "0.1.0",
    "bridge": {
      "running": true,
      "port": 8080,
      "uptime_sec": 123.4,
      "total_requests": 142
    },
    "last_event": {
      "timestamp": 1700000000.123,
      "command": "actor_spawn",
      "result": "success",
      "duration_ms": 132
    },
    "subsystems": {
      "blueprint_builder": {
        "loaded": true,
        "version": "0.1.0"
      },
      "widget_blueprint_builder": {
        "loaded": true,
        "version": "0.1.0"
      },
      "shaderweave": {
        "registered": true,
        "active_sessions": 0
      }
    }
  }
}
```

### `GET /` (existing)

Backward-compatible health check. Unchanged. Uses the standard `{success, data, error}` shape.

All three GET endpoints use the same `{success: bool, data: any, error?: string}` response shape that the rest of the system uses. The `/status` data is nested inside `data`, not at the top level.

### Python implementation notes

- New module-level vars in `listener.py`: `_start_time` (set in `start()`), `_last_event_timestamp`, `_last_event_command`, `_last_event_result`, `_last_event_duration_ms`
- `_process_command_queue` updates last-event vars after each command (with `time.time()` timestamp and elapsed duration)
- `do_GET` routes by path: `/ping`, `/status`, `/` (default)
- Subsystem detection: cached bools set once at startup on the game thread, read by HTTP thread. If a subsystem is loaded after listener startup (e.g., hot-reload), the cached value stays stale until editor restart. This is a known v1 limitation -- periodic re-detection is a v2 improvement.
  - `blueprint_builder.loaded`: check if `UBlueprintGraphBuilderLibrary` class is available via `unreal.find_class()`
  - `widget_blueprint_builder.loaded`: check if `UWidgetBlueprintBuilderLibrary` class is available via `unreal.find_class()`
  - `shaderweave.registered`: bool flag set when ShaderWeave handler registers itself
- All reads are from thread-safe counters or startup-cached bools -- no `unreal.*` calls on HTTP thread

## C++ State Model

### `FBridgeState`

```cpp
struct FBridgeState
{
    // Connection (two signals)
    bool bHttpReachable = false;    // TCP + HTTP response received
    bool bStatusValid = false;      // JSON parsed and schema valid
    int32 Port = 8080;
    float UptimeSec = 0.f;
    double LastSuccessTime = 0.0;   // FPlatformTime::Seconds()
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
    bool bShaderWeaveRegistered = false;
    int32 ShaderWeaveActiveSessions = 0;

    // Subsystems (continued)
    bool bWidgetBlueprintBuilderLoaded = false;
    FString WidgetBlueprintBuilderVersion;

    // Diagnostics
    int32 ConsecutiveFailures = 0;
    FString LastError;
};
```

### Three UI states

| State | Condition | Indicator |
|---|---|---|
| Healthy | `bHttpReachable && bStatusValid` | Green |
| Degraded | `bHttpReachable && !bStatusValid` | Yellow |
| Disconnected | `!bHttpReachable` | Red |

### `FBridgeStatusService`

Owns polling lifecycle and state updates. UI reads state, never writes.

```cpp
class FBridgeStatusService
{
    FBridgeState CurrentState;
    TSharedPtr<IHttpRequest> ActiveRequest;
    FDelegateHandle TickerHandle;
    bool bRequestInFlight = false;

    void StartPolling();    // 1s interval via FTicker::GetCoreTicker().AddTicker()
    void StopPolling();
    bool Tick(float DeltaTime);
    void SendStatusRequest();
    void OnResponseReceived(FHttpRequestPtr, FHttpResponsePtr, bool bSuccess);
    void CancelActiveRequest();

    const FBridgeState& GetState() const { return CurrentState; }
};
```

**Polling behavior:**

- Default interval: 1 second
- If `bRequestInFlight` is true, skip the tick (prevents request stacking)
- On success: parse JSON, update state, set `bHttpReachable = true`, `bStatusValid = true`, `ConsecutiveFailures = 0`, `LastSuccessTime = FPlatformTime::Seconds()`
- On HTTP failure: set `bHttpReachable = false`, `bStatusValid = false`, increment `ConsecutiveFailures`, set `LastError` to error description. Do NOT clear stale data (TotalRequests, subsystem fields)
- On JSON parse failure: set `bHttpReachable = true`, `bStatusValid = false`, increment `ConsecutiveFailures`, set `LastError`
- Backoff: after 3 consecutive failures, slow to 5s polling. Reset to 1s on first success
- Cancel: `CancelActiveRequest()` cancels any in-flight request before sending new one (used by reconnect button)

**Activity log ring buffer:**

- `FBridgeStatusService` maintains a `TArray<FBridgeLogEntry>` ring buffer (max 50 entries)
- New entries pushed when `last_event.timestamp` changes between polls (comparison by timestamp, not command string)
- Each entry: timestamp, command, result, duration_ms
- **Known v1 limitation:** `last_event` is a single-event field, not a queue. If two or more commands complete between polls (within the 1s interval), only the last one appears. The `TotalRequests` counter can detect missed events (if it jumps by more than 1 between polls), but the individual missed commands are not recoverable. A `recent_events` array is a v2 improvement.

```cpp
struct FBridgeLogEntry
{
    FDateTime Timestamp;
    FString Command;
    FString Result;
    float DurationMs;
};
```

## UI Layout

### Dockable Tab: `SBridgeDashboardTab`

Registered as `NomadTab` named `"UEBridgeDashboard"`. Appears in Window > Developer Tools menu.

Four vertical sections:

#### Section 1: Connection Header (top bar)

Always visible. Shows the single most important thing.

```
[green dot] Bridge: Connected (localhost:8080)  |  Last seen: 0.3s ago  |  [Reconnect]
```

Disconnected state:

```
[red dot] Bridge: Disconnected  |  Last seen: 14.2s ago  |  [Reconnect]
```

- Colored dot: `SImage` with green/yellow/red brush
- "Last seen" computed: `FPlatformTime::Seconds() - LastSuccessTime`, updated on UI tick
- Reconnect button: cancels active request, resets `ConsecutiveFailures` to 0, forces immediate poll. UI shows "Connecting..." text (this is a display string, not a fourth state -- the underlying state remains Disconnected until the poll succeeds)

#### Section 2: Subsystem Cards (middle)

Four horizontal `SBorder` boxes, one per subsystem.

**UE Bridge (Core)**
- Status: Running / Down (green/red text)
- Total requests: 142
- Last: `actor_spawn` -- success (132ms)

**Blueprint Builder**
- Status: Loaded / Not found
- Version: 0.1.0

**Widget Blueprint Builder**
- Status: Loaded / Not found
- Version: 0.1.0

**ShaderWeave**
- Status: Registered / Not registered
- Active sessions: 0

When `!bHttpReachable`: all cards show grayed-out text, status shows "Unknown", optional "(stale)" label. No green/red coloring when disconnected -- that would be misleading.

#### Section 3: Activity Log (bottom, expandable)

`SListView<TSharedPtr<FBridgeLogEntry>>` bound to the ring buffer.

Each row:
```
[10:21:04]  actor_spawn        success   132ms
[10:20:58]  blueprint_build    error     --
```

Newest entries at top. Error rows in red/orange text. Clicking could expand to show `LastError` message (v2 feature -- v1 just shows the one-liner).

#### Section 4: Quick Actions (bottom bar)

Four `SButton` widgets:

| Button | Action |
|---|---|
| Restart Listener | POST `{"command": "restart_listener"}`, immediately set `bHttpReachable = false` (don't wait for timeout -- the server we're connected to is dying), then resume normal polling. The POST response will likely be lost (connection reset) -- treat a dropped connection as the expected success case, not an error. |
| Test Connection | Cancel active request, force immediate `/status` poll |
| Open Output Log | `FGlobalTabmanager::Get()->TryInvokeTab(FName("OutputLog"))` |
| Clear Log | Clear activity ring buffer |

### Status Bar Indicator: `SBridgeStatusIndicator`

A toolbar button registered via `FLevelEditorModule::GetToolBarExtensibilityManager()`. UE4.27 does not have `GetStatusBarExtensibilityManager()`, so we use the toolbar extension point instead. This places a small button in the level editor toolbar area.

Visual: colored circle icon + "Bridge" text label on the button.

```
[green dot] Bridge
```

Tooltip on hover (via `SetToolTipText` or `SToolTip`):
```
Connected (localhost:8080)
Last seen: 0.3s ago
Total requests: 142
```

Click: `FGlobalTabmanager::Get()->TryInvokeTab(FName("UEBridgeDashboard"))` (opens/focuses dashboard tab).

The button icon color updates based on connection state (green/yellow/red). Implementation uses `FSlateIcon` with a custom brush or the built-in circle icons with tint.

## File Structure

All files in `Plugins/UEBridgeDashboard/Source/UEBridgeDashboard/`:

```
Public/
    UEBridgeDashboard.h                 -- FUEBridgeDashboardModule (module interface)
    BridgeState.h                       -- FBridgeState, FBridgeLogEntry structs
    BridgeStatusService.h               -- FBridgeStatusService (polling + state)
Private/
    UEBridgeDashboard.cpp               -- module startup/shutdown, register tab + status bar, own service
    BridgeStatusService.cpp             -- HTTP polling, JSON parse, state updates, ring buffer
    SBridgeDashboardTab.h               -- Slate tab widget (private, not exported)
    SBridgeDashboardTab.cpp             -- all 4 UI sections, reads FBridgeState
    SBridgeStatusIndicator.h            -- status bar dot widget (private)
    SBridgeStatusIndicator.cpp          -- dot + tooltip + click handler
```

### Build.cs Dependencies

Add to `PrivateDependencyModuleNames`:

```csharp
"HTTP",
"Json",
"JsonUtilities",
"LevelEditor",
"EditorStyle",
"InputCore",
"UnrealEd"
```

`Slate` and `SlateCore` are already present.

### uplugin Changes

- Module type: `"Runtime"` to `"Editor"` (this is an editor-only plugin)
- Loading phase: `"Default"` to `"PostEngineInit"` (needs LevelEditor module loaded first)

## Pass Structure

### Pass 1: Foundation
- Update `.uplugin` (type, loading phase)
- Update `Build.cs` (dependencies)
- `FBridgeState` + `FBridgeLogEntry` structs
- `FBridgeStatusService` with HTTP polling, JSON parsing, state updates
- Python `/status` + `/ping` endpoints
- Module startup registers tab spawner
- Tab shows live connection status text (no fancy layout yet)
- Verify: open tab, see "Connected" or "Disconnected" updating live

### Pass 2: Dashboard UI
- `SBridgeDashboardTab` with all 4 sections (header, cards, log, actions)
- Wire to `FBridgeState` reads
- Reconnect + Test Connection buttons functional
- Restart Listener button with immediate-disconnect behavior
- Activity log ring buffer and `SListView`

### Pass 3: Status Bar + Polish
- `SBridgeStatusIndicator` in level editor status bar
- Tooltip on hover
- Click to open dashboard
- Color states (green/yellow/red) for both tab and indicator
- Grayed-out stale state when disconnected
- Backoff logic (3 failures to 5s, reset on success)

## Decisions and Trade-offs

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| UI framework | C++ Slate | Python EditorUtilityWidget | Dockable, persistent layouts, native feel, correct layer for infrastructure |
| Data transport | HTTP polling | Shared file/UObject | Same protocol as rest of system, no split brain, works for remote later |
| Polling interval | 1s default | Faster/slower | Responsive without spam, simple backoff on failure |
| Activity log source | `last_event.timestamp` diff | `LastCommand` string diff | Handles repeated commands, timing-accurate |
| Plugin location | Separate from BlueprintGraphBuilder | Inside BlueprintGraphBuilder | Dashboard monitors the whole bridge, not just blueprints; independent packaging |
| Status bar | Toolbar button via `GetToolBarExtensibilityManager()` | `GetStatusBarExtensibilityManager()` | Status bar API does not exist in UE4.27; toolbar extension is the available equivalent |

## Out of Scope

- Node editors, shader graph UI, or blueprint editing surfaces (separate products)
- Settings/configuration panel (v2)
- Remote bridge connections (architecture supports it, UI doesn't expose it yet)
- Push-based events from Python (polling is sufficient for v1)
- Onboarding wizard (B/C user tier, not needed for A tier)
- Marketplace packaging, installer scripts (separate workstream)
