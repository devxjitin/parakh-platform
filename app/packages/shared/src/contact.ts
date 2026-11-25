import { z } from 'zod';

/** The company website's contact form. `website` is a honeypot: real people leave it empty. */
export const contactMessageSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  phone: z.string().trim().max(30).optional(),
  company: z.string().trim().max(120).optional(),
  topic: z.string().trim().max(120).optional(),
  budget: z.string().trim().max(120).optional(),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(4000),
  website: z.string().max(200).optional(),
});
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
