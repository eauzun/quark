import { z } from 'zod';
import { isAddress, parseEther } from 'viem';

// Shared by the browser (fail fast, clear messages) and the API (authoritative checks).
const isHttps = (value: string) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const monAmount = (value: string) => { try { const wei = parseEther(value); return wei > 0n && wei <= parseEther('1000000'); } catch { return false; } };

export const walletAddress = z.string().trim().refine(isAddress, 'Invalid wallet address.').transform(v => v.toLowerCase());
export const levelSchema = z.enum(['basic', 'expert']);
export const roleSchema = z.enum(['worker', 'employer']);
export const categorySchema = z.enum(['Development', 'Security', 'Testing', 'Review'], 'Choose a valid category.');
export const usernameSchema = z.string().trim().min(2, 'Username must be at least 2 characters.').max(40, 'Username must be 40 characters or fewer.').regex(/^[\p{L}\p{N} _.-]+$/u, 'Use letters, numbers, spaces, dots, dashes or underscores.');
export const companySchema = z.string().trim().min(2, 'Company name must be at least 2 characters.').max(80, 'Company name must be 80 characters or fewer.');
export const httpsUrl = z.string().trim().max(2000, 'Link is too long.').refine(isHttps, 'Use a valid HTTPS link.');
export const ratingSchema = z.number('Choose a rating from 1 to 5.').int('Choose a rating from 1 to 5.').min(1, 'Choose a rating from 1 to 5.').max(5, 'Choose a rating from 1 to 5.');
export const reasonSchema = z.string().trim().min(1, 'Explain which acceptance criteria are not met.').max(500, 'Keep the reason under 500 characters.');
export const reviewCommentSchema = z.string().trim().min(10, 'Write at least 10 characters about the collaboration.').max(600, 'Keep the review under 600 characters.');
export const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash.');

export const taskInputSchema = z.object({
  title: z.string().trim().min(8, 'Title must be at least 8 characters.').max(120, 'Title must be 120 characters or fewer.'),
  description: z.string().trim().min(30, 'Describe the work in at least 30 characters.').max(6000, 'Brief must be 6000 characters or fewer.'),
  category: categorySchema,
  level: levelSchema,
  amount: z.string().trim().regex(/^\d+(\.\d{1,18})?$/, 'Enter a MON amount, e.g. 12 or 0.5.').refine(monAmount, 'Reward must be greater than 0 and at most 1,000,000 MON.'),
  deadline: z.number().int().refine(v => v > Date.now() / 1000 + 300 && v <= Date.now() / 1000 + 90 * 86400, 'Deadline must be between 5 minutes and 90 days from now.')
});
export const registrationSchema = z.object({ intent: z.enum(['login', 'register']), role: roleSchema, displayName: usernameSchema.optional(), companyName: companySchema.optional() }).superRefine((data, ctx) => {
  if (data.intent === 'register' && !data.displayName) ctx.addIssue({ code: 'custom', message: 'Choose a username to create your account.', path: ['displayName'] });
  if (data.intent === 'register' && data.role === 'employer' && !data.companyName) ctx.addIssue({ code: 'custom', message: 'Enter your company name.', path: ['companyName'] });
});
export const profileSchema = z.object({ name: usernameSchema, companyName: z.union([z.literal(''), companySchema]).optional() });
export const deliverySchema = z.object({ url: httpsUrl });
export const approveSchema = z.object({ rating: ratingSchema });
export const rejectSchema = z.object({ reason: reasonSchema });
export const reviewInputSchema = z.object({ rating: ratingSchema, comment: reviewCommentSchema });
export const examAnswersSchema = z.array(z.number().int().min(0, 'Answer every question.').max(3)).length(5, 'Answer every question.');

/** Parses `value` or throws an Error carrying the first human-readable issue. */
export function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0]?.message || 'Invalid input.');
  return result.data;
}

/** Returns the URL only when it is a well-formed HTTPS link, so external links can never become `javascript:` or relative app routes. */
export function safeExternalUrl(value: string | undefined) { return value && isHttps(value) ? value : undefined; }
