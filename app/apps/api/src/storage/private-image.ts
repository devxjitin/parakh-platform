import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { Storage, StoredFile } from './storage.service';

export const IMAGE_MAX_BYTES = 512 * 1024;

export function validateImage(file: Buffer | undefined, label: string) {
  if (!file?.length) throw new BadRequestException('Choose an image file');
  if (file.length > IMAGE_MAX_BYTES) {
    throw new BadRequestException(`The ${label} must be 512 KB or smaller`);
  }
  if (
    file.length > 8 &&
    file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { type: 'image/png', ext: 'png' };
  }
  if (file.length > 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  throw new BadRequestException(`The ${label} must be a PNG or JPEG image`);
}

export async function readPrivateImage(storage: Storage, key: string | null | undefined) {
  const file = key ? await storage.get(key) : null;
  if (!file) throw new NotFoundException('Image not found');
  return file;
}

export function sendPrivateImage(res: Response, file: StoredFile) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.body);
}
