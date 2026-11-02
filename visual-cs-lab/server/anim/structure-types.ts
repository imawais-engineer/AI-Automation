/**
 * The geometry a structure animation draws at one step.
 *
 * A frame is plain data: nodes with positions, the edges between them and the
 * pointer labels that name positions in the structure (FRONT, REAR, a level).
 * Layout functions build a frame from a *verified* trace step, the plan stores
 * one frame per step, and the painter draws whichever frame the timeline is on —
 * so nothing is positioned at draw time and the same frame can be inspected,
 * thumbnailed or encoded.
 */

export type StructureTone = 'normal' | 'active' | 'done' | 'dim';

export type StructureNode = {
  id: string;
  /** The text on the node: a value, a key. */
  value: string;
  /** A small label under the node (slot, level, order). */
  sub?: string;
  /** Centre of the node in design coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: StructureTone;
};

export type StructureEdge = {
  from: string;
  to: string;
  /** Draw the link as a dashed "pointer" instead of a solid parent link. */
  dashed?: boolean;
};

/** A chip that names a position in the structure, anchored to a node. */
export type StructureMarker = {
  node: string;
  label: string;
  tone?: 'accent' | 'coral' | 'violet';
  place?: 'above' | 'below';
};

/** Static text in design coordinates: bucket numbers, level names. */
export type StructureLabel = {
  text: string;
  x: number;
  y: number;
  align?: 'left' | 'center' | 'right';
  size?: number;
};

export type StructureFrame = {
  nodes: StructureNode[];
  edges: StructureEdge[];
  markers: StructureMarker[];
  labels: StructureLabel[];
  /** One line under the structure describing its state. */
  note?: string;
};

/** What every verified structure step has to provide to the animation. */
export type StructureStepCopy = {
  n: number;
  message: string;
  hudLabel: string;
  hudDetail: string;
};

export function emptyFrame(): StructureFrame {
  return { nodes: [], edges: [], markers: [], labels: [] };
}
