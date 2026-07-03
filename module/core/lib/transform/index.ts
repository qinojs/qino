// Registriert alle eingebauten Transformer (Reihenfolge = Registrierungsreihenfolge innerhalb einer Phase)
import './transformers/gifGuard.ts';
import './transformers/pdfDecode.ts';
import './transformers/videoDecode.ts';
import './transformers/audioDecode.ts';
import './transformers/markdown.ts';
import './transformers/ocr.ts';
import './transformers/imageResize.ts';
import './transformers/imageEncode.ts';
import './transformers/pngquant.ts';

export { FileTransformer } from './FileTransformer.ts';
export { registerOcrEngine } from './ocr.ts';
export type { OcrEngine } from './ocr.ts';
export type { TransformOptions, TransformResult, TransformerDef, TransformContext } from './types.ts';
