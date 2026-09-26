import Fastify, { type FastifyRequest } from 'fastify';
import { randomBytes, randomInt } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { SiweMessage } from 'siwe';
import { z } from 'zod';
import { createPublicClient, encodeAbiParameters, encodeFunctionData, formatEther, getAddress, http, isAddress, keccak256, parseEther, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { badgeAbi, escrowAbi, monad, skillIds } from '../lib/contracts';
import type { Level, Review, Task } from '../lib/types';
import { approveSchema, deliverySchema, examAnswersSchema, levelSchema, profileSchema, registrationSchema, rejectSchema, reviewInputSchema, roleSchema, safeExternalUrl, taskInputSchema, txHashSchema, walletAddress } from '../lib/validators';
import { db } from './db';
import { authSettings, settings } from './config';
import { graph, indexedTask, indexedTasks, type IndexedTask } from './indexed';

const taskId = z.string().regex(/^\d+$/, 'Invalid task id.');
const client = () => createPublicClient({ chain: monad, transport: http(process.env.RPC_URL || monad.rpcUrls.default.http[0]) });
const fail = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };
const cookieName = 'quark_session';
const cookie = (value: string, maxAge: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`;
async function session(request: FastifyRequest) {
  const token = request.headers.cookie?.split('; ').find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return fail('Sign in with your wallet to continue.', 401);
  try {
    const config = authSettings();
    const { payload } = await jwtVerify(token, config.secret, { issuer: 'quark', audience: config.origin });
    if (typeof payload.sub !== 'string' || !isAddress(payload.sub)) return fail('Invalid session.', 401);
    return payload.sub.toLowerCase();
  } catch { return fail('Your session expired. Please sign in again.', 401); }
}
async function onchain(id: string) { return client().readContract({ address: settings().escrow, abi: escrowAbi, functionName: 'tasks', args: [BigInt(id)] }); }
function tx(data: Hex, value = 0n, to = settings().escrow) { return { transaction: { to, data, value: value.toString(), chainId: 10143 } }; }
async function hydrate(rows: IndexedTask[]): Promise<Task[]> {
  const ids = rows.map(t => t.id);
  const [metadata, applications, deliveries, users] = await Promise.all([
    db.taskMetadata.findMany({ where: { chainId: { in: ids } } }), db.application.findMany({ where: { taskId: { in: ids } } }),
    db.delivery.findMany({ where: { taskId: { in: ids } }, orderBy: { createdAt: 'desc' } }), db.user.findMany({ where: { wallet: { in: rows.map(t => t.employer) } } })
  ]);
  return rows.map(t => {
    const m = metadata.find(m => m.chainId === t.id);
    const employer = users.find(u => u.wallet === t.employer);
    return { id: t.id, title: m?.title || `On-chain task #${t.id}`, description: m?.description || 'Task metadata is being synchronized.', category: m?.category || 'Development', level: t.requiredSkillId === skillIds.expert ? 'expert' : 'basic', employer: t.employer, employerName: employer?.companyName || employer?.username || employer?.displayName || `${t.employer.slice(0, 6)}...${t.employer.slice(-4)}`, worker: t.worker || undefined, amount: formatEther(BigInt(t.amount)), status: t.status as Task['status'], deadline: Number(t.deadline), createdAt: Number(t.createdAt), applicants: applications.filter(a => a.taskId === t.id).map(a => a.worker), delivery: deliveries.find(d => d.taskId === t.id && d.hash === t.deliveryHash)?.url, deliveryHash: t.deliveryHash, reviewDeadline: Number(t.reviewDeadline), rejections: t.rejections, reason: t.reason, rating: t.rating, txHash: t.txHash };
  });
}

export function createApi() {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues[0]?.message || 'Invalid input.' });
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[Quark API]', error.message);
    reply.code(status).send({ error: status >= 500 ? 'Service unavailable. Check configuration or try again shortly.' : error.message });
  });
  app.addHook('onRequest', async (request) => {
    if (request.method !== 'GET' && request.headers.origin !== process.env.APP_ORIGIN) fail('Request origin is not allowed.', 403);
  });
  // Every /tasks/:id route addresses an on-chain uint256 id; reject anything else before it reaches the RPC or database.
  app.addHook('preValidation', async (request) => {
    const id = (request.params as { id?: string } | undefined)?.id;
    if (id !== undefined && request.routeOptions.url?.startsWith('/tasks/:id')) taskId.parse(id);
  });
  app.get('/health', async () => ({ ok: true, chainId: 10143, mode: process.env.NEXT_PUBLIC_APP_MODE || 'demo' }));
  app.post('/auth/nonce', async () => {
    authSettings();
    const nonce = randomBytes(20).toString('hex');
    await db.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.authNonce.create({ data: { nonce, expiresAt: new Date(Date.now() + 300000) } });
    return { nonce };
  });
  app.post('/auth/verify', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const { message, signature } = z.object({ message: z.string().max(4096), signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature.').max(2048) }).parse(body);
    const { intent, role, displayName, companyName } = registrationSchema.parse({ intent: body.intent ?? 'login', role: body.role ?? 'worker', displayName: body.displayName, companyName: body.companyName });
    const siwe = new SiweMessage(message);
    const config = authSettings();
    if (siwe.chainId !== 10143 || siwe.domain !== config.domain || siwe.uri !== config.origin || !siwe.issuedAt || Math.abs(Date.now() - Date.parse(siwe.issuedAt)) > 300000 || siwe.statement !== 'Sign in to Quark on Monad Testnet.') fail('Invalid sign-in message.', 401);
    const nonce = await db.authNonce.findUnique({ where: { nonce: siwe.nonce } });
    if (!nonce || nonce.expiresAt < new Date()) fail('Nonce expired.', 401);
    if (!await client().verifyMessage({ address: getAddress(siwe.address), message, signature: signature as Hex })) fail('Invalid signature.', 401);
    const consumed = await db.authNonce.deleteMany({ where: { nonce: siwe.nonce, expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) fail('Nonce already used.', 401);
    const wallet = siwe.address.toLowerCase();
    const existing = await db.user.findUnique({ where: { wallet } });
    if (intent === 'login' && !existing) fail('No Quark account found for this wallet. Register first.', 404);
    if (displayName) {
      const occupied = await db.user.findUnique({ where: { username: displayName } });
      if (occupied && occupied.wallet !== wallet) fail('That username is already taken.', 409);
    }
    await db.user.upsert({ where: { wallet }, create: { wallet, username: displayName || null, activeRole: role, displayName: displayName || '', companyName: companyName || '' }, update: { activeRole: role, ...(displayName ? { username: displayName, displayName } : {}), ...(companyName ? { companyName } : {}) } });
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(wallet).setIssuer('quark').setAudience(config.origin).setIssuedAt().setExpirationTime('24h').sign(config.secret);
    reply.header('Set-Cookie', cookie(token, 86400));
    return { address: wallet, role };
  });
  app.get('/auth/session', async request => {
    const wallet = await session(request);
    const user = await db.user.findUnique({ where: { wallet }, select: { activeRole: true, username: true, displayName: true, companyName: true } });
    return { address: wallet, role: user?.activeRole === 'employer' ? 'employer' : 'worker', name: user?.username || user?.displayName || '', companyName: user?.companyName || '' };
  });
  app.post('/auth/role', async request => {
    const wallet = await session(request);
    const { role } = z.object({ role: roleSchema }).parse(request.body);
    await db.user.update({ where: { wallet }, data: { activeRole: role } });
    return { role };
  });
  app.post('/auth/logout', async (_request, reply) => { reply.header('Set-Cookie', cookie('', 0)); return { ok: true }; });
  app.get('/tasks', async () => ({ tasks: await hydrate(await indexedTasks()) }));
  app.get<{ Params: { id: string } }>('/tasks/:id', async request => {
    const t = await indexedTask(request.params.id);
    if (!t) return fail('Task not found or not indexed yet.', 404);
    return { task: (await hydrate([t]))[0] };
  });
  app.post('/tasks', async request => {
    const employer = await session(request);
    const input = taskInputSchema.parse(request.body);
    const draft = await db.taskMetadata.create({ data: { ...input, employer, deadline: BigInt(input.deadline) } });
    return { draftId: draft.id, ...tx(encodeFunctionData({ abi: escrowAbi, functionName: 'createTask', args: [skillIds[input.level], parseEther(input.amount), BigInt(input.deadline)] }), parseEther(input.amount)) };
  });
  app.post<{ Params: { id: string } }>('/tasks/drafts/:id/confirm', async request => {
    const wallet = await session(request);
    const { taskId: chainTaskId, txHash } = z.object({ taskId, txHash: txHashSchema }).parse(request.body);
    const draft = await db.taskMetadata.findUnique({ where: { id: request.params.id } });
    if (!draft || draft.employer !== wallet) return fail('Draft not found.', 404);
    const receipt = await client().getTransactionReceipt({ hash: txHash as Hex });
    const t = await onchain(chainTaskId);
    const { parseEventLogs } = await import('viem');
    const created = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: 'TaskCreated' }).find(l => l.address.toLowerCase() === settings().escrow.toLowerCase() && l.args.taskId.toString() === chainTaskId);
    if (receipt.status !== 'success' || !created || t[0].toLowerCase() !== wallet || t[2] !== skillIds[draft.level as Level] || t[3] !== parseEther(draft.amount) || t[4] !== draft.deadline) fail('Transaction does not match this task.');
    await db.taskMetadata.update({ where: { id: draft.id }, data: { chainId: chainTaskId, txHash } });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/tasks/:id/apply', async request => {
    const worker = await session(request); const t = await onchain(request.params.id);
    if (t[7] !== 0 || t[4] < BigInt(Math.floor(Date.now() / 1000)) || t[0].toLowerCase() === worker) fail('This task is not accepting applications.');
    if (!await client().readContract({ address: settings().badge, abi: badgeAbi, functionName: 'hasBadge', args: [worker as Address, t[2]] })) fail('Earn the required skill badge before applying.');
    await db.application.upsert({ where: { taskId_worker: { taskId: request.params.id, worker } }, create: { taskId: request.params.id, worker }, update: {} });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/tasks/:id/assign', async request => {
    const employer = await session(request); const id = request.params.id;
    const worker = walletAddress.parse((request.body as { worker?: string })?.worker);
    const t = await onchain(id);
    if (t[0].toLowerCase() !== employer || t[7] !== 0) fail('Only the employer can assign an open task.', 403);
    if (!await db.application.findUnique({ where: { taskId_worker: { taskId: id, worker } } })) fail('Worker has not applied.');
    return tx(encodeFunctionData({ abi: escrowAbi, functionName: 'assignWorker', args: [BigInt(id), worker as Address] }));
  });
  app.post<{ Params: { id: string } }>('/tasks/:id/deliver', async request => {
    const worker = await session(request); const id = request.params.id;
    const { url } = deliverySchema.parse(request.body);
    const t = await onchain(id);
    if (t[1].toLowerCase() !== worker || !(t[7] === 1 || (t[7] === 4 && t[8] === 1))) fail('Only the assigned worker can submit.', 403);
    const hash = keccak256(toHex(url));
    await db.delivery.upsert({ where: { taskId_hash: { taskId: id, hash } }, create: { taskId: id, worker, url, hash }, update: {} });
    return tx(encodeFunctionData({ abi: escrowAbi, functionName: 'submitDelivery', args: [BigInt(id), hash] }));
  });
  for (const action of ['approve', 'reject', 'refund', 'claim'] as const) {
    app.post<{ Params: { id: string } }>(`/tasks/:id/${action}`, async request => {
      const wallet = await session(request); const id = request.params.id; const t = await onchain(id);
      if ((action === 'claim' ? t[1] : t[0]).toLowerCase() !== wallet) fail('Not authorized for this task.', 403);
      if (action === 'approve') {
        const { rating } = approveSchema.parse(request.body);
        return tx(encodeFunctionData({ abi: escrowAbi, functionName: 'approve', args: [BigInt(id), rating] }));
      }
      if (action === 'reject') {
        const { reason } = rejectSchema.parse(request.body);
        return tx(encodeFunctionData({ abi: escrowAbi, functionName: 'reject', args: [BigInt(id), reason] }));
      }
      return tx(encodeFunctionData({ abi: escrowAbi, functionName: action === 'claim' ? 'claimAfterReview' : 'refund', args: [BigInt(id)] }));
    });
  }
  app.get('/skills', async () => ({ skills: await db.skill.findMany() }));
  app.get<{ Params: { id: string } }>('/skills/:id/questions', async request => {
    const worker = await session(request); const level = levelSchema.parse(request.params.id);
    const last = await db.skillAttempt.findFirst({ where: { worker, skillId: level }, orderBy: { attemptedAt: 'desc' } });
    if (last && !last.completedAt && last.expiresAt > new Date()) {
      const questions = await db.skillQuestion.findMany({ where: { id: { in: last.questionIds as string[] } }, select: { id: true, question: true, options: true } });
      return { attemptId: last.id, expiresAt: last.expiresAt.getTime(), questions: (last.questionIds as string[]).map(id => questions.find(q => q.id === id)) };
    }
    if (last && last.attemptedAt.getTime() > Date.now() - 600000) fail('You can retry this assessment in 10 minutes.', 429);
    const pool = await db.skillQuestion.findMany({ where: { skillId: level }, select: { id: true, question: true, options: true } });
    for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const questions = pool.slice(0, 5);
    if (questions.length !== 5) fail('Assessment has not been seeded.', 503);
    const expiresAt = new Date(Date.now() + 300000);
    const attempt = await db.skillAttempt.create({ data: { worker, skillId: level, questionIds: questions.map(q => q.id), expiresAt } });
    return { attemptId: attempt.id, expiresAt: expiresAt.getTime(), questions };
  });
  app.post<{ Params: { id: string } }>('/skills/:id/attempt', async request => {
    const worker = await session(request); const level = levelSchema.parse(request.params.id);
    const { attemptId, answers } = z.object({ attemptId: z.string().min(1).max(64), answers: examAnswersSchema }).parse(request.body);
    const attempt = await db.skillAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.worker !== worker || attempt.skillId !== level) return fail('Assessment not found.', 404);
    let score = attempt.score;
    if (!attempt.completedAt) {
      if (attempt.expiresAt < new Date()) fail('Assessment expired.');
      const ids = attempt.questionIds as string[];
      const questions = await db.skillQuestion.findMany({ where: { id: { in: ids } } });
      score = ids.reduce((sum, id, i) => sum + (questions.find(q => q.id === id)?.correctOption === answers[i] ? 20 : 0), 0);
      const saved = await db.skillAttempt.updateMany({ where: { id: attemptId, completedAt: null }, data: { score, passed: score >= 80, completedAt: new Date() } });
      if (!saved.count) fail('Assessment already submitted.');
    }
    if (score === null || score < 80) return { passed: false, score };
    const config = settings();
    if (!config.oracleKey) fail('Assessment signer is not configured.', 503);
    const payload = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], [10143n, config.badge, worker as Address, skillIds[level]]));
    const signature = await privateKeyToAccount(config.oracleKey!).signMessage({ message: { raw: payload } });
    return { passed: true, score, ...tx(encodeFunctionData({ abi: badgeAbi, functionName: 'mintBadge', args: [worker as Address, skillIds[level], signature] }), 0n, config.badge) };
  });
  app.get<{ Params: { address: string } }>('/reputation/:address', async request => {
    const wallet = walletAddress.parse(request.params.address);
    const [user, data] = await Promise.all([db.user.findUnique({ where: { wallet } }), graph<{ Score: { completedTasks: number; ratingSum: number; totalEarned: string; totalSpent: string }[]; Badge: { skillId: string }[] }>('query($wallet: String!) { Score(where: {id: {_eq: $wallet}}) { completedTasks ratingSum totalEarned totalSpent } Badge(where: {worker: {_eq: $wallet}}) { skillId } }', { wallet })]);
    const score = data.Score[0];
    return { address: wallet, name: user?.username || user?.displayName || '', companyName: user?.companyName || '', badges: Object.entries(skillIds).filter(([, id]) => data.Badge.some(b => b.skillId === id)).map(([level]) => level), completed: score?.completedTasks || 0, rating: score?.completedTasks ? score.ratingSum / score.completedTasks : 0, earned: formatEther(BigInt(score?.totalEarned || '0')), spent: formatEther(BigInt(score?.totalSpent || '0')) };
  });
  app.post('/profile', async request => {
    const wallet = await session(request); const { name, companyName } = profileSchema.parse(request.body);
    const occupied = await db.user.findUnique({ where: { username: name } });
    if (occupied && occupied.wallet !== wallet) fail('That username is already taken.', 409);
    await db.user.update({ where: { wallet }, data: { username: name, displayName: name, ...(companyName !== undefined ? { companyName } : {}) } }); return { ok: true };
  });
  app.get<{ Params: { address: string } }>('/reviews/:address', async request => {
    const wallet = walletAddress.parse(request.params.address);
    const rows = await db.review.findMany({ where: { OR: [{ reviewee: wallet }, { reviewer: wallet }] }, orderBy: { createdAt: 'desc' }, take: 200 });
    const ids = [...new Set(rows.map(r => r.taskId))];
    const [metadata, users] = await Promise.all([db.taskMetadata.findMany({ where: { chainId: { in: ids } }, select: { chainId: true, title: true } }), db.user.findMany({ where: { wallet: { in: rows.map(r => r.reviewer) } } })]);
    const reviews: Review[] = rows.map(r => { const u = users.find(u => u.wallet === r.reviewer); return { id: r.id, taskId: r.taskId, taskTitle: metadata.find(m => m.chainId === r.taskId)?.title || `On-chain task #${r.taskId}`, from: r.reviewer, fromName: u?.companyName || u?.username || `${r.reviewer.slice(0, 6)}...${r.reviewer.slice(-4)}`, to: r.reviewee, fromRole: r.reviewerRole === 'employer' ? 'employer' : 'worker', rating: r.rating, comment: r.comment, createdAt: Math.floor(r.createdAt.getTime() / 1000) }; });
    return { reviews };
  });
  app.post<{ Params: { id: string } }>('/tasks/:id/review', async request => {
    const wallet = await session(request); const id = request.params.id;
    const { rating, comment } = reviewInputSchema.parse(request.body);
    const t = await onchain(id);
    const employer = t[0].toLowerCase(); const worker = t[1].toLowerCase();
    if (t[7] !== 3) fail('Reviews open after the task is approved and paid.');
    if (wallet !== employer && wallet !== worker) fail('Only the employer and worker of this task can review it.', 403);
    if (await db.review.findUnique({ where: { taskId_reviewer: { taskId: id, reviewer: wallet } } })) fail('You already reviewed this task.', 409);
    await db.review.create({ data: { taskId: id, reviewer: wallet, reviewee: wallet === employer ? worker : employer, reviewerRole: wallet === employer ? 'employer' : 'worker', rating, comment } });
    return { ok: true };
  });
  app.get('/ecosystem/programs', async () => ({ programs: await db.ecosystemProgram.findMany({ where: { active: true } }) }));
  app.get('/ecosystem/projects', async () => {
    const [projects, tasks] = await Promise.all([db.communityProject.findMany(), indexedTasks()]);
    return { projects: projects.filter(p => safeExternalUrl(p.url)).map(p => ({ ...p, hiringOnQuark: !!p.employer && tasks.some(t => t.employer === p.employer && t.status === 'open' && Number(t.deadline) > Date.now() / 1000) })) };
  });
  return app;
}
let api: ReturnType<typeof createApi> | undefined;
export function getApi() { return api ||= createApi(); }
