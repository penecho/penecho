export type Vec = [number, number, number];
export interface Entity {
  id: string; label: string; form: string; color: string; motion: string;
  target: string; relation: string; scale: string; detail: string; count: string;
  confidence: number; formConfidence: number; alternatives?: Record<string, number>;
  family?: string;
  celestial?: boolean;
  blueprint?: { family: string; params: Record<string, string> };
  physics?: { kind: string; gravity: number; speed: number; eccentricity: number; height: number; restitution: number; period: number };
  sculpture?: { nodes: SculptNode[]; status: string; nextId: number };
}
export interface SculptNode { id: string; role: string; parent: string | null; site: string; shape: string; size: Vec; orientation: string; symmetry: string; color: string; bend: number; taper: number; twist: number; motion: string; edits: number; }
export interface SculptAction { entity: string; op: string; label: string; confidence: number; target?: string; }
export interface SculptStep { index: number; actions: SculptAction[]; world: World; elapsedMs: number; }
export interface World { entities: Entity[]; mood: string; abstract: boolean; engine?: string; domain?: string; omitted?: number; }
export interface Meta { engine?: string; model: string; latencyMs: number; candidates: number; questions: number; choices: number; calls: number; usage?: { input_tokens: number; output_tokens: number }; }
