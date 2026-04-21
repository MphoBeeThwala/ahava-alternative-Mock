// Minimal ambient declaration — replaced by @types/pdfkit once installed on CI/Railway.
// Keeps local TypeScript compilation happy when the npm types package cannot be installed.
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    margin?: number;
    size?: string | [number, number];
    layout?: 'portrait' | 'landscape';
    [key: string]: unknown;
  }

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    page: { width: number; height: number };
    on(event: 'data', handler: (chunk: Buffer) => void): this;
    on(event: 'end', handler: () => void): this;
    on(event: 'error', handler: (err: Error) => void): this;
    end(): void;
    rect(x: number, y: number, w: number, h: number): this;
    fill(color: string): this;
    stroke(): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    strokeColor(color: string): this;
    lineWidth(w: number): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    font(name: string): this;
    text(str: string, x?: number, y?: number, options?: Record<string, unknown>): this;
    heightOfString(str: string, options?: Record<string, unknown>): number;
    setHeader?: (name: string, val: string) => this;
  }

  export = PDFDocument;
}
