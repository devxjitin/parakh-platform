import { z } from 'zod';

export const categoryNameSchema = z
  .string({ message: 'Enter a category name' })
  .trim()
  .min(2, 'At least 2 characters')
  .max(40, 'At most 40 characters');

export const categoryInputSchema = z.object({ name: categoryNameSchema });
export type CategoryInput = z.infer<typeof categoryInputSchema>;

/** One category in the admin list, with how many exams are filed under it. */
export interface CategoryDto {
  id: string;
  name: string;
  examCount: number;
}
