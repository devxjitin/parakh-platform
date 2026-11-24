import { z } from 'zod';

/** Closing your own account. The password is asked again so a stolen session cannot do it. */
export const deleteAccountSchema = z.object({
  // Students have no password (they proved their email this visit), so it is only asked of trainers.
  password: z.string().min(1, 'Enter your password').max(128).optional(),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
