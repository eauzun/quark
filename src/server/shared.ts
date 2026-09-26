import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { formatEther, parseEther, type Hex, type PublicClient } from 'viem';
import type { Notification, Review, SharedTask } from '@prisma/client';
import type { Level, Notification as AppNotification, Profile, Review as AppReview, Task } from '../lib/types';
import { approveSchema, deliverySchema, rejectSchema, reviewInputSchema, taskInputSchema, txHashSchema, walletAddress } from '../lib/validators';
import { db } from './db';

type Helpers = { session: (request: FastifyRequest) => Promise<string>; fail: (message: string, statusCode?: number) => never; client: () => PublicClient };
export const sharedMode = () => process.env.NEXT_PUBLIC_APP_MODE === 'shared';
const now = () => Math.floor(Date.now() / 1000);
const shortWallet = (w: string) => `${w.slice(0, 6)}...${w.slice(-4)}`;

async function names(wallets: string[]) {
  const users = await db.user.findMany({ where: { wallet: { in: [...new Set(wallets)] } } });
  return (w: string) => { const u = users.find(u => u.wallet === w); return u?.companyName || u?.username || u?.displayName || shortWallet(w); };
}
async function toTasks(rows: SharedTask[]): Promise<Task[]> {
  const name = await names(rows.map(r => r.employer));
  return rows.map(t => ({ id: t.id, title: t.title, description: t.description, category: t.category, level: t.level as Level, amount: t.amount, employer: t.employer, employerName: name(t.employer), worker: t.worker || undefined, status: t.status as Task['status'], deadline: t.deadline, createdAt: Math.floor(t.createdAt.getTime() / 1000), applicants: t.applicants as string[], delivery: t.delivery || undefined, reviewDeadline: t.reviewDeadline || undefined, rejections: t.rejections, reason: t.reason || undefined, rating: t.rating || undefined, txHash: t.txHash || undefined }));
}
const notify = (wallet: string, taskId: string, kind: AppNotification['kind'], message: string) => db.notification.create({ data: { wallet, taskId, kind, message } });
const toNotification = (n: Notification): AppNotification => ({ id: n.id, taskId: n.taskId, kind: n.kind as AppNotification['kind'], message: n.message, read: n.read, createdAt: Math.floor(n.createdAt.getTime() / 1000) });

export function registerShared(app: FastifyInstance, { session, fail, client }: Helpers) {
  app.addHook('onRequest', async request => { if (request.url.startsWith('/shared/') && !sharedMode()) fail('Shared mode is not enabled.', 404); });
  const load = async (id: string) => (await db.sharedTask.findUnique({ where: { id } })) || fail('Task not found.', 404);
  const sharedId = z.string().min(1).max(40).regex(/^[a-z0-9]+$/, 'Invalid task id.');

  app.get('/shared/tasks', async () => ({ tasks: await toTasks(await db.sharedTask.findMany({ orderBy: { createdAt: 'desc' }, take: 300 })) }));
  app.post('/shared/tasks', async request => {
    const employer = await session(request); const input = taskInputSchema.parse(request.body);
    const task = await db.sharedTask.create({ data: { ...input, employer } });
    return { task: (await toTasks([task]))[0] };
  });
  app.post<{ Params: { id: string; action: string } }>('/shared/tasks/:id/:action', async request => {
    const wallet = await session(request); const id = sharedId.parse(request.params.id); const action = request.params.action;
    const t = await load(id); const owner = t.employer === wallet; const worker = t.worker === wallet;
    const applicants = t.applicants as string[]; const name = await names([wallet]);
    if (action === 'apply') {
      if (owner || t.status !== 'open' || t.deadline < now()) fail('This task is not accepting applications.');
      if (!await db.sharedBadge.findUnique({ where: { worker_level: { worker: wallet, level: t.level } } })) fail('Earn the required skill badge in Skills first.');
      if (!applicants.includes(wallet)) { await db.sharedTask.update({ where: { id }, data: { applicants: [...applicants, wallet] } }); await notify(t.employer, id, 'applied', `${name(wallet)} applied to "${t.title}".`); }
    } else if (action === 'assign') {
      const candidate = walletAddress.parse((request.body as { worker?: string })?.worker);
      if (!owner || t.status !== 'open' || !applicants.includes(candidate)) fail('This worker cannot be assigned.', 403);
      await db.sharedTask.update({ where: { id }, data: { worker: candidate, status: 'assigned' } });
      await notify(candidate, id, 'assigned', `You were assigned to "${t.title}". Deliver before the deadline.`);
    } else if (action === 'deliver') {
      const { url } = deliverySchema.parse(request.body);
      if (!worker || now() > t.deadline || !(t.status === 'assigned' || (t.status === 'rejected' && t.rejections === 1))) fail('No delivery is available for this task.', 403);
      await db.sharedTask.update({ where: { id }, data: { delivery: url, status: 'delivered', reviewDeadline: now() + 3 * 86400 } });
      await notify(t.employer, id, 'delivered', `${name(wallet)} delivered "${t.title}". Approve to pay ${t.amount} MON, or request a revision.`);
    } else if (action === 'reject') {
      const { reason } = rejectSchema.parse(request.body);
      if (!owner || t.status !== 'delivered') fail('Only a delivered task can be rejected.', 403);
      await db.sharedTask.update({ where: { id }, data: { status: 'rejected', reason, rejections: t.rejections + 1, deadline: now() + 3 * 86400 } });
      await notify(t.worker!, id, 'rejected', `Revision requested on "${t.title}": ${reason}`);
    } else if (action === 'cancel') {
      if (!owner || t.status !== 'open') fail('Only an open task can be cancelled.', 403);
      await db.sharedTask.update({ where: { id }, data: { status: 'refunded' } });
    } else if (action === 'pay') {
      // The employer's wallet already sent MON to the worker; verify that exact transfer on Monad before marking the task paid.
      const { txHash, rating } = z.object({ txHash: txHashSchema, rating: approveSchema.shape.rating }).parse(request.body);
      if (!owner || t.status !== 'delivered' || !t.worker) fail('Only the employer can pay a delivered task.', 403);
      const [tx, receipt] = await Promise.all([client().getTransaction({ hash: txHash as Hex }), client().getTransactionReceipt({ hash: txHash as Hex })]).catch(() => fail('Payment transaction was not found on Monad Testnet yet. Try again in a few seconds.'));
      if (receipt.status !== 'success' || tx.from.toLowerCase() !== t.employer || tx.to?.toLowerCase() !== t.worker || tx.value !== parseEther(t.amount)) fail('Transaction does not match this payment.');
      const paid = await db.sharedTask.updateMany({ where: { id, status: 'delivered' }, data: { status: 'approved', rating, txHash } });
      if (!paid.count) fail('This task was already settled.', 409);
      await notify(t.worker!, id, 'paid', `${t.amount} MON received for "${t.title}". Rating: ${rating}/5.`);
    } else if (action === 'review') {
      const { rating, comment } = reviewInputSchema.parse(request.body);
      if (t.status !== 'approved' || (!owner && !worker)) fail('Reviews open after the task is approved and paid.');
      if (await db.review.findUnique({ where: { taskId_reviewer: { taskId: id, reviewer: wallet } } })) fail('You already reviewed this task.', 409);
      await db.review.create({ data: { taskId: id, reviewer: wallet, reviewee: owner ? t.worker! : t.employer, reviewerRole: owner ? 'employer' : 'worker', rating, comment } });
    } else fail('Unknown action.', 404);
    return { ok: true };
  });
  app.get<{ Params: { address: string } }>('/shared/reputation/:address', async request => {
    const wallet = walletAddress.parse(request.params.address);
    const [user, done, badges] = await Promise.all([db.user.findUnique({ where: { wallet } }), db.sharedTask.findMany({ where: { status: 'approved', OR: [{ worker: wallet }, { employer: wallet }] } }), db.sharedBadge.findMany({ where: { worker: wallet } })]);
    const worked = done.filter(t => t.worker === wallet);
    const sum = (rows: SharedTask[]) => formatEther(rows.reduce((total, t) => total + parseEther(t.amount), 0n));
    const profile: Profile = { address: wallet, name: user?.username || user?.displayName || '', companyName: user?.companyName || '', badges: badges.map(b => b.level as Level), completed: worked.length, rating: worked.length ? worked.reduce((s, t) => s + (t.rating || 0), 0) / worked.length : 0, earned: sum(worked), spent: sum(done.filter(t => t.employer === wallet)) };
    return profile;
  });
  app.get<{ Params: { address: string } }>('/shared/reviews/:address', async request => {
    const wallet = walletAddress.parse(request.params.address);
    const rows: Review[] = await db.review.findMany({ where: { OR: [{ reviewee: wallet }, { reviewer: wallet }] }, orderBy: { createdAt: 'desc' }, take: 200 });
    const [tasks, name] = await Promise.all([db.sharedTask.findMany({ where: { id: { in: rows.map(r => r.taskId) } }, select: { id: true, title: true } }), names(rows.map(r => r.reviewer))]);
    const reviews: AppReview[] = rows.map(r => ({ id: r.id, taskId: r.taskId, taskTitle: tasks.find(t => t.id === r.taskId)?.title || 'Task', from: r.reviewer, fromName: name(r.reviewer), to: r.reviewee, fromRole: r.reviewerRole === 'employer' ? 'employer' : 'worker', rating: r.rating, comment: r.comment, createdAt: Math.floor(r.createdAt.getTime() / 1000) }));
    return { reviews };
  });
  app.get('/shared/notifications', async request => {
    const wallet = await session(request);
    return { notifications: (await db.notification.findMany({ where: { wallet }, orderBy: { createdAt: 'desc' }, take: 30 })).map(toNotification) };
  });
  app.post('/shared/notifications/read', async request => {
    const wallet = await session(request);
    await db.notification.updateMany({ where: { wallet, read: false }, data: { read: true } });
    return { ok: true };
  });
}
