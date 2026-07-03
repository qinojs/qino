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
  fmt?: 'avif' | 'jpeg' | 'jpg' | 'png' | 'md' | 'auto';
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
  /** Option keys consumed by this transformer – fed into the cache key */
  props: string[];
  /** Must run after this transformer (same phase) */
  after?: string;
  handles: (ctx: TransformContext) => boolean | Promise<boolean>;
  transform: (ctx: TransformContext) => Promise<void>;
}

export interface TransformResult {
  path: string;
  mime: string;
  /** false = original returned (no transform or error) */
  transformed: boolean;
  /** Cache key = content identity (source + options), stable across mtime touches – usable as ETag */
  key?: string;
  error?: Error;
}
