export type Phase = 'decode' | 'geometry' | 'filter' | 'encode';

export interface TransformOptions {
  w?: number;
  h?: number;
  q?: number;
  max?: boolean;
  vpos?: number;
  hpos?: number;
  zoom?: number;
  dpr?: number;
  page?: number;
  frame?: number;
  fmt?: 'avif' | 'jpeg' | 'jpg' | 'png' | 'auto';
  [key: string]: unknown;
}

export interface TransformMeta {
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  animated?: boolean;
  geometryApplied?: boolean;
  [key: string]: unknown;
}

export interface TransformContext {
  readonly sourcePath: string;
  currentPath: string;
  mime: string;
  options: TransformOptions;
  meta: TransformMeta;
  tmpDir: string;
}

export interface TransformerDef {
  name: string;
  phase: Phase;
  /** Options-Keys die dieser Transformer konsumiert – fließen in den Cache-Key ein */
  props: string[];
  /** Muss nach diesem Transformer (gleiche Phase) ausgeführt werden */
  after?: string;
  handles: (ctx: TransformContext) => boolean | Promise<boolean>;
  transform: (ctx: TransformContext) => Promise<void>;
}

export interface TransformResult {
  path: string;
  mime: string;
  /** false = Original zurückgegeben (kein Transform oder Fehler) */
  transformed: boolean;
  error?: Error;
}
