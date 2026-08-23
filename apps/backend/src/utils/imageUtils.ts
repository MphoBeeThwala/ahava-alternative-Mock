/**
 * Image Utilities for Medical Image Processing
 * Handles EXIF metadata stripping for privacy protection
 */

import sharp from 'sharp';

/**
 * Metadata tags to strip from medical images
 */
const EXIF_TAGS_TO_STRIP = [
  'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
  'GPSAltitudeRef', 'GPSTimeStamp', 'GPSDateStamp',
  'Make', 'Model', 'SerialNumber', 'LensMake', 'LensModel', 'LensSerialNumber',
  'DateTime', 'DateTimeOriginal', 'DateTimeDigitized',
  'Artist', 'Copyright', 'UserComment', 'Software', 'ImageUniqueID',
];

/**
 * Options for image processing
 */
export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  stripAllMetadata?: boolean;
}

const DEFAULT_OPTIONS: Required<ImageProcessingOptions> = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 85,
  format: 'jpeg',
  stripAllMetadata: true,
};

/**
 * Validates that a buffer is a valid image
 */
export async function validateImageBuffer(buffer: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(buffer).metadata();
    return metadata.width !== undefined && metadata.height !== undefined;
  } catch {
    return false;
  }
}

/**
 * Strips EXIF and other metadata from an image buffer
 */
export async function stripMetadataFromBuffer(
  buffer: Buffer,
  options: ImageProcessingOptions = {},
): Promise<Buffer> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  
  const processor = sharp(buffer);
  
  // Resize if needed
  if (mergedOptions.maxWidth || mergedOptions.maxHeight) {
    processor.resize({
      width: mergedOptions.maxWidth,
      height: mergedOptions.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  
  // Strip all metadata by default
  processor.withMetadata({});
  
  // Convert format and set quality
  return processor
    .toFormat(mergedOptions.format, {
      quality: mergedOptions.quality,
      progressive: true,
      force: false,
    })
    .toBuffer();
}

/**
 * Processes an uploaded image for safe storage
 */
export async function processUploadedImage(
  file: Express.Multer.File,
  options: ImageProcessingOptions = {},
): Promise<{
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}> {
  const isValid = await validateImageBuffer(file.buffer);
  if (!isValid) {
    throw new Error('Invalid image file');
  }
  
  const processedBuffer = await stripMetadataFromBuffer(file.buffer, options);
  const metadata = await sharp(processedBuffer).metadata();
  
  return {
    buffer: processedBuffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: processedBuffer.length,
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

/**
 * Express middleware to strip metadata from uploaded images
 */
export function stripImageMetadataMiddleware(
  fieldName: string = 'image',
  options: ImageProcessingOptions = {},
) {
  return async (req: any, res: any, next: any) => {
    try {
      if (!req.files || !req.files[fieldName]) {
        return next();
      }
      
      const file = req.files[fieldName];
      const processed = await processUploadedImage(file, options);
      
      req.files[fieldName] = {
        ...file,
        buffer: processed.buffer,
        size: processed.size,
      };
      
      next();
    } catch (error) {
      next(error);
    }
  };
}

export default {
  validateImageBuffer,
  stripMetadataFromBuffer,
  processUploadedImage,
  stripImageMetadataMiddleware,
};
