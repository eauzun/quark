import type { Review, ReviewSummary } from './types';

export function summarizeReviews(reviews: Review[]): ReviewSummary {
  const distribution: ReviewSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) distribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
  return { count: reviews.length, average: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0, distribution };
}
export const reviewedBy = (reviews: Review[], taskId: string, wallet: string) => reviews.some(r => r.taskId === taskId && r.from === wallet);
