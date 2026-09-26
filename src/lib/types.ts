export type Level = 'basic' | 'expert';
export type Status = 'open' | 'assigned' | 'delivered' | 'approved' | 'rejected' | 'refunded';
export type Task = {
  id: string; title: string; description: string; category: string; level: Level;
  amount: string; employer: string; employerName: string; worker?: string;
  status: Status; deadline: number; createdAt: number; applicants: string[];
  delivery?: string; deliveryHash?: string; reviewDeadline?: number; rejections: number;
  reason?: string; rating?: number; txHash?: string;
};
export type Profile = { address: string; name: string; companyName?: string; badges: Level[]; completed: number; rating: number; earned: string; spent: string };
export type Question = { id: string; question: string; options: string[] };
export type Exam = { attemptId: string; expiresAt: number; questions: Question[] };
export type Project = { id: string; name: string; category: string; description: string; url: string; employer?: string; hiringOnQuark: boolean; demo?: boolean };
export type Program = { id: string; title: string; description: string; url: string; program: string };
export type Transaction = { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
/** A post-completion evaluation one task party leaves for the other. `fromRole` is the reviewer's role on that task. */
export type Review = { id: string; taskId: string; taskTitle: string; from: string; fromName: string; to: string; fromRole: 'employer' | 'worker'; rating: number; comment: string; createdAt: number };
export type ReviewSummary = { count: number; average: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> };
