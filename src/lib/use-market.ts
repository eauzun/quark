'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSendTransaction, useSignMessage, useSwitchChain } from 'wagmi';
import { SiweMessage } from 'siwe';
import { formatEther, parseEther, parseEventLogs, type Hex } from 'viem';
import { escrowAbi, addresses, monad } from './contracts';
import { DEMO_EMPLOYER, DEMO_WORKER, demoExam, initialDemo, type DemoState } from './demo';
import type { Exam, Level, Notification, Profile, Program, Project, Review, Task, Transaction } from './types';
import { reviewedBy } from './reviews';
import { approveSchema, deliverySchema, examAnswersSchema, profileSchema, registrationSchema, rejectSchema, reviewInputSchema, taskInputSchema, validate, walletAddress } from './validators';

export const appMode = process.env.NEXT_PUBLIC_APP_MODE === 'live' ? 'live' : process.env.NEXT_PUBLIC_APP_MODE === 'shared' ? 'shared' : 'demo';
export const isDemo = appMode === 'demo';
/** Shared mode: one Postgres-backed board for every device, approvals paid wallet-to-wallet with MetaMask. */
export const isShared = appMode === 'shared';
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}
const demoKey = 'quark-demo-v1';
// wagmi's injected({ target: 'metaMask' }) uses 'metaMask'; EIP-6963 discovery announces MetaMask as 'io.metamask'.
const metaMaskIds = ['metaMask', 'io.metamask', 'metaMaskSDK'];
type InjectedProvider = { isMetaMask?: boolean; providers?: InjectedProvider[] };
function detectMetaMask() {
  const ethereum = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  return !!ethereum && (!!ethereum.isMetaMask || !!ethereum.providers?.some(p => p.isMetaMask));
}
function friendlyError(e: unknown) {
  const error = e as { code?: number; name?: string; message?: string; cause?: { code?: number } };
  if (error?.code === 4001 || error?.cause?.code === 4001 || error?.name === 'UserRejectedRequestError') return 'The request was rejected in MetaMask.';
  if (error?.name === 'ConnectorAlreadyConnectedError') return 'MetaMask is already connected.';
  return error instanceof Error ? error.message.split('\n')[0] : 'Something went wrong. Please retry.';
}
export function useMarket() {
  const account = useAccount(); const { connectAsync, connectors } = useConnect(); const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage(); const { switchChainAsync } = useSwitchChain(); const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient({ chainId: 10143 });
  const [demo, setDemo] = useState<DemoState>(() => initialDemo());
  const [ready, setReady] = useState(false); const [role, setRole] = useState<'worker' | 'employer'>('worker');
  const [tasks, setTasks] = useState<Task[]>([]); const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionAddress, setSessionAddress] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState(''); const [lastTx, setLastTx] = useState('');
  const [reviews, setReviews] = useState<Review[]>([]); const [notifications, setNotifications] = useState<Notification[]>([]); const [metaMaskInstalled, setMetaMaskInstalled] = useState(false);
  const wallet = isDemo ? (role === 'worker' ? DEMO_WORKER : DEMO_EMPLOYER) : account.address?.toLowerCase() || '';
  const signedIn = isDemo || (!!wallet && sessionAddress === wallet);
  useEffect(() => {
    if (isDemo) { try { const stored = localStorage.getItem(demoKey); if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed.tasks) && parsed.profiles?.[DEMO_WORKER] && parsed.profiles?.[DEMO_EMPLOYER]) setDemo({ ...parsed, reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [] }); } } catch { /* A blocked or full storage must not prevent the demo from opening. */ } }
    setMetaMaskInstalled(detectMetaMask());
    setReady(true);
  }, []);
  useEffect(() => { if (isDemo && ready) { try { localStorage.setItem(demoKey, JSON.stringify(demo)); } catch { setError('Browser storage is unavailable. Demo changes will last for this session only.'); } } }, [demo, ready]);
  const refresh = useCallback(async () => {
    if (isDemo) { setLoading(false); return; }
    try {
      const base = isShared ? '/shared' : '';
      const data = await api<{ tasks: Task[] }>(`${base}/tasks`); setTasks(data.tasks);
      if (wallet) { const [nextProfile, received] = await Promise.all([api<Profile>(`${base}/reputation/${wallet}`), api<{ reviews: Review[] }>(`${base}/reviews/${wallet}`)]); setProfile(nextProfile); setReviews(received.reviews); }
      else { setProfile(null); setReviews([]); }
      if (isShared && wallet && sessionAddress === wallet) setNotifications((await api<{ notifications: Notification[] }>('/shared/notifications')).notifications);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load tasks.'); }
    finally { setLoading(false); }
  }, [wallet, sessionAddress]);
  useEffect(() => { void refresh(); if (!isDemo) { void api<{ address: string; role: 'worker' | 'employer'; name: string; companyName: string }>('/auth/session').then(v => { setSessionAddress(v.address); setRole(v.role); setProfile(current => current ? { ...current, name: v.name, companyName: v.companyName } : { address: v.address, name: v.name, companyName: v.companyName, badges: [], completed: 0, rating: 0, earned: '0', spent: '0' }); }).catch(() => setSessionAddress('')); const interval = setInterval(() => void refresh(), isShared ? 4000 : 12000); return () => clearInterval(interval); } }, [refresh]);
  async function run(label: string, operation: () => Promise<void>) {
    if (busy) return false; setBusy(label); setError(''); setNotice('');
    try { await operation(); return true; }
    catch (e) { setError(friendlyError(e)); return false; }
    finally { setBusy(''); }
  }
  async function ensureSession() {
    if (isDemo) return;
    if (!account.address) throw new Error('Connect your wallet first.');
    if (account.chainId !== 10143) await switchChainAsync({ chainId: 10143 });
    if (!signedIn) throw new Error('Sign in with your wallet first.');
  }
  async function connectMetaMask() {
    const connector = connectors.find(c => metaMaskIds.includes(c.id));
    if (!detectMetaMask() || !connector) throw new Error('MetaMask was not found. Install the MetaMask extension, then reload this page.');
    const result = await connectAsync({ connector, chainId: 10143 });
    return result.accounts[0];
  }
  async function login(selectedRole: 'worker' | 'employer' = role, intent: 'login' | 'register' = 'login', registration?: { displayName: string; companyName?: string }) {
    return run('Connecting MetaMask', async () => {
      const valid = validate(registrationSchema, { intent, role: selectedRole, ...registration });
      setRole(selectedRole);
      const address = account.address || await connectMetaMask();
      await switchChainAsync({ chainId: 10143 });
      const { nonce } = await api<{ nonce: string }>('/auth/nonce', {});
      const message = new SiweMessage({ domain: window.location.host, address, statement: 'Sign in to Quark on Monad Testnet.', uri: window.location.origin, version: '1', chainId: 10143, nonce }).prepareMessage();
      const signature = await signMessageAsync({ message });
      const session = await api<{ address: string; role: 'worker' | 'employer' }>('/auth/verify', { message, signature, ...valid });
      setSessionAddress(session.address); setRole(session.role); setNotice(`Wallet verified. Welcome, ${session.role}.`);
    });
  }
  async function changeRole(next: 'worker' | 'employer') {
    if (next === role) return;
    if (isDemo || !signedIn) { setRole(next); return; }
    await run('Updating account mode', async () => { await api('/auth/role', { role: next }); setRole(next); setNotice(`Account mode changed to ${next}.`); });
  }
  async function broadcast(transaction: Transaction) {
    await ensureSession();
    if (transaction.chainId !== 10143 || ![addresses.escrow?.toLowerCase(), addresses.badge?.toLowerCase()].includes(transaction.to.toLowerCase())) throw new Error('Unexpected transaction target. Check your deployment configuration.');
    const hash = await sendTransactionAsync({ to: transaction.to, data: transaction.data, value: BigInt(transaction.value), chainId: 10143 });
    setLastTx(hash); setBusy('Waiting for confirmation');
    const receipt = await publicClient!.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== 'success') throw new Error('Transaction reverted. No action was completed.');
    setNotice('Transaction confirmed. The board updates when indexing catches up.');
    await refresh();
    return receipt;
  }
  async function action(task: Task, action: 'apply' | 'assign' | 'deliver' | 'approve' | 'reject' | 'refund' | 'claim', body: Record<string, unknown> = {}) {
    return run(action === 'approve' ? 'Releasing MON' : 'Updating task', async () => {
      const input: Record<string, unknown> = action === 'deliver' ? validate(deliverySchema, body) : action === 'approve' ? validate(approveSchema, body) : action === 'reject' ? validate(rejectSchema, body) : action === 'assign' ? { worker: validate(walletAddress, body.worker) } : {};
      await ensureSession();
      if (isShared) {
        if (action === 'claim') throw new Error('Shared mode pays on approval; there is no escrow to claim.');
        if (action === 'approve') {
          // Direct wallet-to-wallet payment: the employer's MetaMask sends the task amount to the worker, then the server verifies it on-chain.
          if (!task.worker) throw new Error('This task has no assigned worker.');
          const hash = await sendTransactionAsync({ to: task.worker as Hex, value: parseEther(task.amount), chainId: 10143 });
          setLastTx(hash); setBusy('Waiting for confirmation');
          const receipt = await publicClient!.waitForTransactionReceipt({ hash, confirmations: 1 });
          if (receipt.status !== 'success') throw new Error('Payment transaction reverted. The task was not marked as paid.');
          await api(`/shared/tasks/${task.id}/pay`, { txHash: hash, rating: input.rating });
          await refresh(); setNotice(`${task.amount} MON sent to the worker's wallet.`); return;
        }
        await api(`/shared/tasks/${task.id}/${action === 'refund' ? 'cancel' : action}`, input);
        await refresh(); setNotice({ apply: 'Application submitted.', assign: 'Worker assigned.', deliver: 'Delivery submitted. The employer has been notified.', reject: 'Revision requested.', refund: 'Task cancelled.' }[action] || 'Task updated.'); return;
      }
      if (!isDemo) { const result = await api<{ transaction?: Transaction }>(`/tasks/${task.id}/${action}`, input); if (result.transaction) await broadcast(result.transaction); else { await refresh(); setNotice('Application submitted.'); } return; }
      const now = Math.floor(Date.now() / 1000); const current = demo.tasks.find(t => t.id === task.id)!;
      const owner = current.employer === wallet; const worker = current.worker === wallet;
      const patch: Partial<Task> = {}; const profiles = { ...demo.profiles };
      if (action === 'apply') {
        if (owner || current.status !== 'open' || current.deadline < now) throw new Error('This task is not accepting applications.');
        if (!profiles[wallet].badges.includes(current.level)) throw new Error('Earn the required badge in Skills first.');
        patch.applicants = [...new Set([...current.applicants, wallet])];
      } else if (action === 'assign') {
        const candidate = String(input.worker);
        if (!owner || current.status !== 'open' || current.deadline < now || !current.applicants.includes(candidate) || !profiles[candidate]?.badges.includes(current.level)) throw new Error('This worker cannot be assigned.');
        Object.assign(patch, { worker: candidate, status: 'assigned' });
      } else if (action === 'deliver') {
        if (!worker || now > current.deadline || !(current.status === 'assigned' || (current.status === 'rejected' && current.rejections === 1))) throw new Error('No delivery is available for this task.');
        Object.assign(patch, { delivery: String(input.url), status: 'delivered', reviewDeadline: now + 3 * 86400 });
      } else if (action === 'approve' || action === 'claim') {
        if (current.status !== 'delivered' || (action === 'approve' ? !owner : !worker || now <= (current.reviewDeadline || Infinity))) throw new Error('This payment is not available.');
        const rating = action === 'claim' ? 3 : Number(input.rating);
        Object.assign(patch, { status: 'approved', rating });
        const w = profiles[current.worker!]; const e = profiles[current.employer];
        profiles[current.worker!] = { ...w, completed: w.completed + 1, rating: (w.rating * w.completed + rating) / (w.completed + 1), earned: formatEther(parseEther(w.earned) + parseEther(current.amount)) };
        profiles[current.employer] = { ...e, spent: formatEther(parseEther(e.spent) + parseEther(current.amount)) };
      } else if (action === 'reject') {
        if (!owner || current.status !== 'delivered' || now > (current.reviewDeadline || 0)) throw new Error('Provide a revision reason within the review window.');
        Object.assign(patch, { status: 'rejected', reason: String(input.reason), rejections: current.rejections + 1, deadline: now + 3 * 86400 });
      } else {
        if (!owner || !(current.status === 'open' || (['assigned', 'rejected'].includes(current.status) && now > current.deadline))) throw new Error('Refund is not available yet.');
        patch.status = 'refunded';
      }
      setDemo(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, ...patch } : t), profiles }));
      setNotice(action === 'approve' || action === 'claim' ? `Demo payment completed: ${current.amount} MON. No real tokens transferred.` : 'Demo task updated.');
    });
  }
  async function createTask(input: { title: string; description: string; category: string; level: Level; amount: string; deadline: number }) {
    return run('Creating escrow', async () => {
      input = validate(taskInputSchema, input);
      await ensureSession();
      if (isDemo) {
        setDemo(prev => ({ ...prev, tasks: [{ ...input, id: `demo-${crypto.randomUUID()}`, employer: wallet, employerName: prev.profiles[wallet].name, status: 'open', createdAt: Math.floor(Date.now() / 1000), applicants: [], rejections: 0 }, ...prev.tasks] }));
        setNotice('Demo task published. The MON escrow is simulated.');
      } else if (isShared) {
        await api('/shared/tasks', input); await refresh(); setNotice('Task published. Workers on every device can see it now.');
      } else {
        const { draftId, transaction } = await api<{ draftId: string; transaction: Transaction }>('/tasks', input);
        const receipt = await broadcast(transaction);
        const event = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: 'TaskCreated' }).find(e => e.address.toLowerCase() === addresses.escrow?.toLowerCase());
        if (!event) throw new Error('Transaction confirmed but TaskCreated was not found.');
        const pending = { draftId, taskId: event.args.taskId.toString(), txHash: receipt.transactionHash };
        localStorage.setItem('quark-pending-metadata', JSON.stringify(pending));
        await api(`/tasks/drafts/${draftId}/confirm`, pending);
        localStorage.removeItem('quark-pending-metadata');
        await refresh();
      }
    });
  }
  async function recoverMetadata() {
    return run('Recovering task details', async () => {
      await ensureSession();
      const raw = localStorage.getItem('quark-pending-metadata');
      if (!raw) throw new Error('There is no pending task metadata on this device.');
      const pending = JSON.parse(raw); await api(`/tasks/drafts/${pending.draftId}/confirm`, pending);
      localStorage.removeItem('quark-pending-metadata'); await refresh(); setNotice('Task details recovered.');
    });
  }
  async function startExam(level: Level): Promise<Exam | undefined> {
    let result: Exam | undefined;
    await run('Preparing assessment', async () => { await ensureSession(); result = isDemo ? demoExam() : await api<Exam>(`/skills/${level}/questions`); });
    return result;
  }
  async function finishExam(level: Level, exam: Exam, answers: number[]): Promise<{ passed: boolean; score: number } | undefined> {
    let result: { passed: boolean; score: number } | undefined;
    await run('Scoring assessment', async () => {
      validate(examAnswersSchema, answers);
      if (exam.expiresAt < Date.now()) throw new Error('Assessment expired. Start a new attempt after the cooldown.');
      if (isDemo) {
        const score = answers.filter(a => a === 0).length * 20; result = { passed: score >= 80, score };
        if (result.passed) setDemo(prev => ({ ...prev, profiles: { ...prev.profiles, [wallet]: { ...prev.profiles[wallet], badges: [...new Set([...prev.profiles[wallet].badges, level])] } } }));
      } else {
        await ensureSession();
        const response = await api<{ passed: boolean; score: number; transaction?: Transaction }>(`/skills/${level}/attempt`, { attemptId: exam.attemptId, answers });
        if (response.transaction) await broadcast(response.transaction);
        result = response;
      }
    });
    return result;
  }
  async function saveProfile(name: string, companyName = profile?.companyName || '') {
    return run('Saving profile', async () => {
      const valid = validate(profileSchema, { name, companyName });
      if (isDemo) setDemo(prev => ({ ...prev, profiles: { ...prev.profiles, [wallet]: { ...prev.profiles[wallet], name: valid.name, companyName: valid.companyName || '' } } }));
      else { await ensureSession(); await api('/profile', valid); await refresh(); }
      setNotice('Profile saved.');
    });
  }
  /** Demo only: runs apply → assign → deliver → approve in one step so the MON payment flow can be shown instantly. */
  async function fastComplete(task: Task) {
    return run('Releasing MON', async () => {
      if (!isDemo) throw new Error('Instant completion is only available in the demo.');
      const current = demo.tasks.find(t => t.id === task.id);
      if (!current || !['open', 'assigned', 'delivered', 'rejected'].includes(current.status)) throw new Error('This task is already settled.');
      const workerId = current.worker || DEMO_WORKER; const now = Math.floor(Date.now() / 1000);
      setDemo(prev => {
        const w = prev.profiles[workerId]; const e = prev.profiles[current.employer];
        const profiles = { ...prev.profiles,
          [workerId]: { ...w, badges: [...new Set([...w.badges, current.level])], completed: w.completed + 1, rating: (w.rating * w.completed + 5) / (w.completed + 1), earned: formatEther(parseEther(w.earned) + parseEther(current.amount)) },
          [current.employer]: { ...e, spent: formatEther(parseEther(e.spent) + parseEther(current.amount)) } };
        return { ...prev, profiles, tasks: prev.tasks.map(t => t.id === task.id ? { ...t, worker: workerId, applicants: [...new Set([...t.applicants, workerId])], delivery: t.delivery || 'https://example.com/demo-delivery', status: 'approved', rating: 5, reviewDeadline: now } : t) };
      });
      setNotice(`Demo payment completed: ${current.amount} MON released from escrow to ${workerName(workerId)}. No real tokens transferred.`);
    });
  }
  const workerName = (id: string) => demo.profiles[id]?.name || 'the builder';
  const allReviews = isDemo ? demo.reviews : reviews;
  async function markNotificationsRead() {
    if (!isShared || !notifications.some(n => !n.read)) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try { await api('/shared/notifications/read', {}); } catch { /* Read state is cosmetic; the next poll reconciles it. */ }
  }
  async function review(task: Task, rating: number, comment: string) {
    return run('Publishing review', async () => {
      const input = validate(reviewInputSchema, { rating, comment });
      await ensureSession();
      const owner = task.employer === wallet; const worker = task.worker === wallet;
      if (task.status !== 'approved' || (!owner && !worker)) throw new Error('Reviews open after the task is approved and paid.');
      if (reviewedBy(allReviews, task.id, wallet)) throw new Error('You already reviewed this task.');
      if (isDemo) {
        setDemo(prev => ({ ...prev, reviews: [{ id: `review-${crypto.randomUUID()}`, taskId: task.id, taskTitle: task.title, from: wallet, fromName: prev.profiles[wallet].companyName || prev.profiles[wallet].name, to: owner ? task.worker! : task.employer, fromRole: owner ? 'employer' : 'worker', ...input, createdAt: Math.floor(Date.now() / 1000) }, ...prev.reviews] }));
      } else { await api(`${isShared ? '/shared' : ''}/tasks/${task.id}/review`, input); await refresh(); }
      setNotice('Review published. Thank you for the feedback.');
    });
  }
  const metaMask = {
    installed: metaMaskInstalled, connected: account.isConnected, address: account.address, onMonad: account.chainId === monad.id,
    connect: () => run('Connecting MetaMask', async () => { await connectMetaMask(); setNotice('MetaMask connected.'); }),
    switchNetwork: () => run('Switching to Monad Testnet', async () => { await switchChainAsync({ chainId: monad.id }); }),
    disconnect: () => disconnect()
  };
  async function logout() { if (!isDemo) await run('Signing out', async () => { await api('/auth/logout', {}); setSessionAddress(''); setProfile(null); disconnect(); }); }
  function resetDemo() { setDemo(initialDemo()); setRole('worker'); setLastTx(''); setNotice('Demo reset.'); }
  return { notifications, markNotificationsRead, reviews: allReviews, review, fastComplete, metaMask, tasks: isDemo ? demo.tasks : tasks, profile: isDemo ? demo.profiles[wallet] : profile, wallet, role, setRole: changeRole, signedIn, ready, loading, busy, error, setError, notice, setNotice, lastTx, login, logout, refresh, action, createTask, startExam, finishExam, saveProfile, resetDemo, recoverMetadata, wrongChain: !isDemo && account.isConnected && account.chainId !== monad.id };
}
export type Market = ReturnType<typeof useMarket>;
export const demoProjects: Project[] = [
  { id: 'orbit', name: 'Orbit Labs', category: 'DeFi', description: 'A sample team building Solidity tools and safer on-chain experiences.', employer: DEMO_EMPLOYER, url: 'https://monad.xyz/developers', hiringOnQuark: true, demo: true },
  { id: 'vertex', name: 'Vertex Studio', category: 'Infra', description: 'A sample developer studio exploring wallet and payment experiences.', employer: DEMO_EMPLOYER, url: 'https://monad.xyz/developers', hiringOnQuark: true, demo: true },
  { id: 'monad', name: 'Monad', category: 'Infra', description: 'Official resources for the network powering Quark.', url: 'https://monad.xyz', hiringOnQuark: false }
];
export const demoPrograms: Program[] = [{ id: 'builders', title: 'Monad Builders', description: 'Find official network resources, documentation, and developer entry points.', url: 'https://monad.xyz/developers', program: 'Developer resources' }];
