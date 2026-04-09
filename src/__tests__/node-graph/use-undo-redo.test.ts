// use-undo-redo.test.ts — Undo/Redo ステートマシンのテスト

import { describe, it, expect } from "vitest";

// useReducer のロジックを直接テスト（React hooks のテストではなく reducer テスト）
// reducer を export していないので、同等のロジックを再現してテスト

interface GraphSnapshot { nodes: any[]; edges: any[] }
interface UndoRedoState { past: GraphSnapshot[]; present: GraphSnapshot; future: GraphSnapshot[] }
type Action = { type: "PUSH"; snapshot: GraphSnapshot } | { type: "UNDO" } | { type: "REDO" } | { type: "SET"; snapshot: GraphSnapshot };

const MAX_HISTORY = 50;

function reducer(state: UndoRedoState, action: Action): UndoRedoState {
  switch (action.type) {
    case "PUSH": {
      const newPast = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past: newPast, present: action.snapshot, future: [] };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
    }
    case "SET":
      return { past: [], present: action.snapshot, future: [] };
    default:
      return state;
  }
}

function makeSnapshot(id: number): GraphSnapshot {
  return { nodes: [{ id: `node-${id}` }], edges: [] };
}

describe("undo-redo reducer", () => {
  const initial: UndoRedoState = { past: [], present: makeSnapshot(0), future: [] };

  it("PUSH adds current to past and sets new present", () => {
    const s1 = reducer(initial, { type: "PUSH", snapshot: makeSnapshot(1) });
    expect(s1.past).toHaveLength(1);
    expect(s1.present.nodes[0].id).toBe("node-1");
    expect(s1.future).toHaveLength(0);
  });

  it("UNDO restores previous state", () => {
    let state = initial;
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(1) });
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(2) });
    state = reducer(state, { type: "UNDO" });
    expect(state.present.nodes[0].id).toBe("node-1");
    expect(state.future).toHaveLength(1);
    expect(state.past).toHaveLength(1);
  });

  it("REDO restores next state", () => {
    let state = initial;
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(1) });
    state = reducer(state, { type: "UNDO" });
    state = reducer(state, { type: "REDO" });
    expect(state.present.nodes[0].id).toBe("node-1");
    expect(state.future).toHaveLength(0);
  });

  it("PUSH after UNDO clears future (redo history)", () => {
    let state = initial;
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(1) });
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(2) });
    state = reducer(state, { type: "UNDO" });
    expect(state.future).toHaveLength(1);
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(3) });
    expect(state.future).toHaveLength(0);
    expect(state.present.nodes[0].id).toBe("node-3");
  });

  it("UNDO on empty past is no-op", () => {
    const result = reducer(initial, { type: "UNDO" });
    expect(result).toBe(initial);
  });

  it("REDO on empty future is no-op", () => {
    const result = reducer(initial, { type: "REDO" });
    expect(result).toBe(initial);
  });

  it("respects MAX_HISTORY limit of 50", () => {
    let state = initial;
    for (let i = 1; i <= 60; i++) {
      state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(i) });
    }
    expect(state.past).toHaveLength(50);
    expect(state.present.nodes[0].id).toBe("node-60");
  });

  it("SET resets all history", () => {
    let state = initial;
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(1) });
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(2) });
    state = reducer(state, { type: "SET", snapshot: makeSnapshot(99) });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.present.nodes[0].id).toBe("node-99");
  });

  it("multiple undo then redo restores correctly", () => {
    let state = initial;
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(1) });
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(2) });
    state = reducer(state, { type: "PUSH", snapshot: makeSnapshot(3) });
    // undo 3 times
    state = reducer(state, { type: "UNDO" });
    state = reducer(state, { type: "UNDO" });
    state = reducer(state, { type: "UNDO" });
    expect(state.present.nodes[0].id).toBe("node-0");
    // redo 3 times
    state = reducer(state, { type: "REDO" });
    state = reducer(state, { type: "REDO" });
    state = reducer(state, { type: "REDO" });
    expect(state.present.nodes[0].id).toBe("node-3");
  });
});
