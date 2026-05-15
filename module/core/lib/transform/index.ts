// Registriert alle eingebauten Transformer (Reihenfolge = Registrierungsreihenfolge innerhalb einer Phase)
import './transformers/gifGuard.ts';
import './transformers/pdfDecode.ts';
import './transformers/videoDecode.ts';
import './transformers/audioDecode.ts';
import './transformers/imageResize.ts';
import './transformers/imageEncode.ts';

export { FileTransformer } from './FileTransformer.ts';
export type { TransformOptions, TransformResult, TransformerDef, TransformContext } from './types.ts';
