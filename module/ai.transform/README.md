# ai1.transform

Registers [ai1](../ai1/) as OCR and transcription engine of the core's file transforms, ahead of
Tesseract: OCR through `ocr` (an OCR model, else `text` with a model with `vision`), transcription
through `transcribe`. Each is available while ai1 has a model for it.
