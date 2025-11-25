// src/lib/orientation.ts
import { loadOrderDraft } from "./order";
export type Orientation = "vertical" | "horizontal";
export function getOrientationFromDraft(): Orientation {
  const d = loadOrderDraft();
  return (d.size?.orientation as Orientation) ?? (d as any).orientation ?? "vertical";
}
