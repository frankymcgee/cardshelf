import { AppError, ensure } from './errors.mjs';
import { decodeSalePhoto, PHOTO_STORED_LIMIT } from './marketplace-validation.mjs';
let processing = 0;
export async function salePhotos(input) {
  ensure(Array.isArray(input) && input.length === 2, 400, 'Add front and back photos.');
  const decoded = input.map(decodeSalePhoto);
  ensure(new Set(decoded.map(p => p.side)).size === 2, 400, 'Add exactly one front and one back photo.');
  ensure(processing < 2, 429, 'The image processor is busy. Try again shortly.');
  processing++;
  try {
    const { default: sharp } = await import('sharp');
    const result = [];
    for (const p of decoded) {
      const image = sharp(p.data, { failOn: 'warning', limitInputPixels: 24_000_000 });
      const metadata = await image.metadata();
      ensure(['jpeg', 'png', 'webp'].includes(metadata.format) && (metadata.pages || 1) === 1, 415, 'Animated or unsupported photos are not accepted.');
      ensure(metadata.width > 0 && metadata.height > 0 && metadata.width <= 12000 && metadata.height <= 12000, 400, 'Photo dimensions are too large.');
      // Decode and re-encode pixels; omit EXIF/GPS and the original uploaded filename.
      const photo = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 3 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
      ensure(photo.data.length <= PHOTO_STORED_LIMIT, 413, 'The optimised photo is too large. Use a smaller photo.');
      result.push({ side: p.side, data: photo.data });
    }
    return result.sort((a, b) => a.side.localeCompare(b.side));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'This photo could not be decoded. Export a smaller JPEG, PNG or WebP.');
  } finally { processing--; }
}
