// _node-graph/hooks/use-undo-redo.ts — Undo/Redo 状態管理

import { useCallback, useReducer } from "react";
import type { Node, Edge } from "@xyflow/react";

interface GraphSnapshot {
  nodes: Node[];
  edges: Edge[];
}

interface UndoRedoState {
  past: GraphSnapshot[];
  present: GraphSnapshot;
  future: GraphSnapshot[];
}

type Action =
  | { type: "PUSH"; snapshot: GraphSnapshot }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET"; snapshot: GraphSnapshot };

const MAX_HISTORY = 50;

function reducer(state: UndoRedoState, action: Action): UndoRedoState {
  switch (action.type) {
    case "PUSH": {
      const newPast = [...state.past, state.present].slice(-MAX_HISTORY);
      return {
        past: newPast,
        present: action.snapshot,
        future: [],
      };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      return {
        past: newPast,
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return {
        past: [...state.past, state.present],
        present: next,
        future: newFuture,
      };
    }
    case "SET": {
      return {
        past: [],
        present: action.snapshot,
        future: [],
      };
    }
    default:
      return state;
  }
}

export function useUndoRedo(initialNodes: Node[], initialEdges: Edge[]) {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: { nodes: initialNodes, edges: initialEdges },
    future: [],
  });

  const pushSnapshot = useCallback((nodes: Node[], edges: Edge[]) => {
    dispatch({ type: "PUSH", snapshot: { nodes, edges } });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const reset = useCallback((nodes: Node[], edges: Edge[]) => {
    dispatch({ type: "SET", snapshot: { nodes, edges } });
  }, []);

  return {
    nodes: state.present.nodes,
    edges: state.present.edges,
    pushSnapshot,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
