/**
 * Core graph patterns for blueprint_build_from_description.
 *
 * Each pattern produces a graph fragment with nodes, connections,
 * and exposed pins. The merger auto-wires exec flow between steps.
 */

import {
  registerPattern,
  type GraphFragment,
  type PatternContext,
} from "./index.js";

// --- on_begin_play ---
// Entry point. No params.

registerPattern(
  "on_begin_play",
  (_params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const id = `${ctx.idPrefix}_begin`;
    return {
      nodes: [{ id, type: "BeginPlay" }],
      connections: [],
      exposedPins: {
        exec_out: `${id}.exec`,
      },
    };
  }
);

// --- print_string ---
// Params: { message: string }

registerPattern(
  "print_string",
  (params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const id = `${ctx.idPrefix}_print`;
    const message = String(params.message ?? "Hello");
    return {
      nodes: [
        {
          id,
          type: "CallFunction",
          function: "PrintString",
          params: { InString: message },
        },
      ],
      connections: [],
      exposedPins: {
        exec_in: `${id}.exec`,
        exec_out: `${id}.exec`,
      },
    };
  }
);

// --- print_float ---
// Params: { source_pin: string }
// Converts a float to string and prints it.

registerPattern(
  "print_float",
  (params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const convId = `${ctx.idPrefix}_conv`;
    const printId = `${ctx.idPrefix}_print`;
    const sourcePinRaw = String(params.source_pin ?? "");

    // Resolve source_pin: if it starts with "step", look it up in previousPins
    let sourcePin = sourcePinRaw;
    if (sourcePinRaw.startsWith("step") && ctx.previousPins[sourcePinRaw]) {
      sourcePin = ctx.previousPins[sourcePinRaw];
    }

    const connections = [
      { from: `${convId}.ReturnValue`, to: `${printId}.InString` },
    ];

    if (sourcePin) {
      connections.unshift({ from: sourcePin, to: `${convId}.InFloat` });
    }

    return {
      nodes: [
        { id: convId, type: "CallFunction", function: "Conv_FloatToString" },
        { id: printId, type: "CallFunction", function: "PrintString" },
      ],
      connections,
      exposedPins: {
        exec_in: `${printId}.exec`,
        exec_out: `${printId}.exec`,
        float_in: `${convId}.InFloat`,
      },
    };
  }
);

// --- get_actor_location ---
// Gets self actor location and breaks into X/Y/Z. No params.

registerPattern(
  "get_actor_location",
  (_params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const getLocId = `${ctx.idPrefix}_getLoc`;
    const breakId = `${ctx.idPrefix}_break`;
    return {
      nodes: [
        {
          id: getLocId,
          type: "CallFunction",
          function: "K2_GetActorLocation",
        },
        { id: breakId, type: "CallFunction", function: "BreakVector" },
      ],
      connections: [
        { from: `${getLocId}.ReturnValue`, to: `${breakId}.InVec` },
      ],
      exposedPins: {
        x: `${breakId}.X`,
        y: `${breakId}.Y`,
        z: `${breakId}.Z`,
      },
    };
  }
);

// --- loop_print ---
// Params: { start?: number, end?: number }
// ForLoop from start to end, printing the index each iteration.

registerPattern(
  "loop_print",
  (params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const loopId = `${ctx.idPrefix}_loop`;
    const convId = `${ctx.idPrefix}_conv`;
    const printId = `${ctx.idPrefix}_print`;
    const start = Number(params.start ?? 0);
    const end = Number(params.end ?? 5);
    return {
      nodes: [
        {
          id: loopId,
          type: "ForLoop",
          params: { FirstIndex: start, LastIndex: end },
        },
        { id: convId, type: "CallFunction", function: "Conv_IntToString" },
        { id: printId, type: "CallFunction", function: "PrintString" },
      ],
      connections: [
        { from: `${loopId}.LoopBody`, to: `${printId}.exec` },
        { from: `${loopId}.Index`, to: `${convId}.InInt` },
        { from: `${convId}.ReturnValue`, to: `${printId}.InString` },
      ],
      exposedPins: {
        exec_in: `${loopId}.exec`,
        exec_out: `${loopId}.Completed`,
        index: `${loopId}.Index`,
      },
    };
  }
);

// --- move_actor_up ---
// Params: { zOffset?: number }
// GetActorLocation -> MakeVector(0,0,zOffset) -> AddVector -> SetActorLocation

registerPattern(
  "move_actor_up",
  (params: Record<string, unknown>, ctx: PatternContext): GraphFragment => {
    const getLocId = `${ctx.idPrefix}_getLoc`;
    const makeVecId = `${ctx.idPrefix}_makeVec`;
    const addId = `${ctx.idPrefix}_add`;
    const setLocId = `${ctx.idPrefix}_setLoc`;
    const zOffset = Number(params.zOffset ?? 300);
    return {
      nodes: [
        {
          id: getLocId,
          type: "CallFunction",
          function: "K2_GetActorLocation",
        },
        {
          id: makeVecId,
          type: "CallFunction",
          function: "MakeVector",
          params: { X: 0, Y: 0, Z: zOffset },
        },
        {
          id: addId,
          type: "CallFunction",
          function: "Add_VectorVector",
        },
        {
          id: setLocId,
          type: "CallFunction",
          function: "K2_SetActorLocation",
        },
      ],
      connections: [
        { from: `${getLocId}.ReturnValue`, to: `${addId}.A` },
        { from: `${makeVecId}.ReturnValue`, to: `${addId}.B` },
        { from: `${addId}.ReturnValue`, to: `${setLocId}.NewLocation` },
      ],
      exposedPins: {
        exec_in: `${setLocId}.exec`,
        exec_out: `${setLocId}.exec`,
      },
    };
  }
);
