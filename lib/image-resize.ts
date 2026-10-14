// Shrinking a phone photo before it is sent or stored (a sheet photo straight from a modern phone is several megabytes). The size rule is pure; the canvas work runs in the browser only.

export const MAX_PHOTO_EDGE = 1600;

// The size that fits inside max on its longest side, keeping the shape; a picture that already fits is left as it is.
export function fitWithin(width: number, height: number, max = MAX_PHOTO_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface ResizedPhoto {
  blob: Blob;
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

// A picked photo -> a JPEG no larger than 1600 pixels on a side, as a file to store and as base64 to send for reading.
export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the photo.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be prepared."))), "image/jpeg", 0.85));
  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      resolve(text.slice(text.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { blob, base64, mediaType: "image/jpeg", width, height };
}
