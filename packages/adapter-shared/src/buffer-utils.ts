/**
 * Buffer conversion utilities for handling file uploads.
 *
 * These utilities handle the conversion of various data types
 * (Buffer, ArrayBuffer, Blob) to Node.js Buffer for file uploads.
 */

import type { PlatformName } from "./card-utils";
import { ValidationError } from "./errors";

/**
 * The supported input types for file data.
 */
export type FileDataInput = Buffer | ArrayBuffer | Blob;

/**
 * Options for buffer conversion.
 */
export interface ToBufferOptions {
  /**
   * The platform name for error messages.
   */
  platform: PlatformName;

  /**
   * If true, throws ValidationError for unsupported types.
   * If false, returns null for unsupported types.
   * Default: true
   */
  throwOnUnsupported?: boolean;
}

/**
 * Convert various data types to a Node.js Buffer.
 *
 * Handles:
 * - Buffer: returned as-is
 * - ArrayBuffer: converted using Buffer.from()
 * - Blob: converted via arrayBuffer() then Buffer.from()
 *
 * @param data - The file data to convert
 * @param options - Conversion options
 * @returns Buffer or null if conversion fails and throwOnUnsupported is false
 * @throws ValidationError if data type is unsupported and throwOnUnsupported is true
 *
 * @example
 * ```typescript
 * // Throw on unsupported (default behavior)
 * const buffer = await toBuffer(file.data, { platform: "slack" });
 *
 * // Return null on unsupported
 * const buffer = await toBuffer(file.data, { platform: "teams", throwOnUnsupported: false });
 * if (!buffer) continue; // Skip unsupported files
 * ```
 */
export async function toBuffer(
  data: FileDataInput | unknown,
  options: ToBufferOptions
): Promise<Buffer | null> {
  const { platform, throwOnUnsupported = true } = options;

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (throwOnUnsupported) {
    throw new ValidationError(platform, "Unsupported file data type");
  }

  return null;
}

/**
 * Synchronous version of toBuffer for non-Blob data.
 *
 * Use this when you know the data is not a Blob (e.g., already validated).
 *
 * @param data - The file data to convert (Buffer or ArrayBuffer only)
 * @param options - Conversion options
 * @returns Buffer or null if conversion fails
 * @throws ValidationError if data is a Blob or unsupported type and throwOnUnsupported is true
 */
export function toBufferSync(
  data: Buffer | ArrayBuffer | unknown,
  options: ToBufferOptions
): Buffer | null {
  const { platform, throwOnUnsupported = true } = options;

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (data instanceof Blob) {
    if (throwOnUnsupported) {
      throw new ValidationError(
        platform,
        "Cannot convert Blob synchronously. Use toBuffer() for async conversion."
      );
    }
    return null;
  }

  if (throwOnUnsupported) {
    throw new ValidationError(platform, "Unsupported file data type");
  }

  return null;
}

/**
 * Convert a Buffer to a data URI string.
 *
 * @param buffer - The buffer to convert
 * @param mimeType - The MIME type (default: application/octet-stream)
 * @returns Data URI string in format `data:{mimeType};base64,{base64Data}`
 *
 * @example
 * ```typescript
 * const dataUri = bufferToDataUri(buffer, "image/png");
 * // "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgA..."
 * ```
 */
export function bufferToDataUri(
  buffer: Buffer,
  mimeType = "application/octet-stream"
): string {
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}
