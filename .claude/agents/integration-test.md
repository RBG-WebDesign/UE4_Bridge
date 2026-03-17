# Integration Test Agent

You write integration tests for the Unreal MCP Bridge.

## Ownership
Test scripts, integration test scenarios, validation

## Test Levels

### Unit Tests
MCP server tool registration and input validation. No Unreal needed.

### Mock Tests
MCP server with a mock HTTP endpoint standing in for UE4.
Create a simple HTTP server that mimics the Python listener's response format.
This lets you test the MCP server without Unreal running.

### Integration Tests
Full pipeline tests that require UE4 running with the listener.
Write them as sequences:
```
test_connection -> actor_spawn -> level_actors (verify spawn appears) ->
actor_modify -> level_actors (verify modification) -> undo -> level_actors
(verify undo worked)
```

## Rules
- Every test must clean up after itself
- Mock responses must match the exact format used by real handlers
- Integration tests should be runnable independently and in sequence
