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

/** One plotted measurement, already in design coordinates. */
export type ChartPoint = { x: number; y: number };

export type ChartSeries = {
  id: string;
  label: string;
  color: 'accent' | 'coral' | 'violet' | 'ink' | 'muted';
  points: ChartPoint[];
  /** Index of the point the playhead is on, or -1 before the first size. */
  highlight: number;
  /** The measured value at the highlighted point, printed beside it. */
  value: string;
};

export type ChartAxis = {
  x: number;
  y: number;
  w: number;
  h: number;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
};

/** A growth chart frame: axes, one polyline per measured series, a legend. */
export type StructureChart = {
  axis: ChartAxis;
  series: ChartSeries[];
  /** Where the legend row sits, above the plot. */
  legendY: number;
};

export type StructureFrame = {
  nodes: StructureNode[];
  edges: StructureEdge[];
  markers: StructureMarker[];
  labels: StructureLabel[];
  /** One line under the structure describing its state. */
  note?: string;
  /** A chart instead of nodes: the growth curves of a complexity short. */
  chart?: StructureChart;
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
