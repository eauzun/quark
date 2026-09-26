import { indexer } from 'envio';

indexer.onEvent({ contract: 'TaskEscrow', event: 'TaskCreated' }, async ({ event, context }) => {
  const p = event.params;
  context.Task.set({ id: p.taskId.toString(), employer: p.employer, worker: '', requiredSkillId: p.requiredSkillId, amount: p.amount, deadline: p.deadline, status: 'open', deliveryHash: '', reviewDeadline: 0n, rejections: 0, reason: '', rating: 0, txHash: event.transaction.hash, createdAt: BigInt(event.block.timestamp) });
});
indexer.onEvent({ contract: 'TaskEscrow', event: 'WorkerAssigned' }, async ({ event, context }) => {
  const t = await context.Task.get(event.params.taskId.toString());
  if (t) context.Task.set({ ...t, worker: event.params.worker, status: 'assigned', txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'TaskEscrow', event: 'DeliverySubmitted' }, async ({ event, context }) => {
  const t = await context.Task.get(event.params.taskId.toString());
  if (t) context.Task.set({ ...t, deliveryHash: event.params.deliveryHash, reviewDeadline: event.params.reviewDeadline, status: 'delivered', txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'TaskEscrow', event: 'TaskApproved' }, async ({ event, context }) => {
  const t = await context.Task.get(event.params.taskId.toString());
  if (t) context.Task.set({ ...t, status: 'approved', rating: Number(event.params.rating), txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'TaskEscrow', event: 'TaskRejected' }, async ({ event, context }) => {
  const t = await context.Task.get(event.params.taskId.toString());
  if (t) context.Task.set({ ...t, status: 'rejected', reason: event.params.reason, rejections: Number(event.params.rejections), deadline: event.params.deadline, txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'TaskEscrow', event: 'TaskRefunded' }, async ({ event, context }) => {
  const t = await context.Task.get(event.params.taskId.toString());
  if (t) context.Task.set({ ...t, status: 'refunded', txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'SkillBadge', event: 'BadgeMinted' }, async ({ event, context }) => {
  context.Badge.set({ id: `${event.params.worker}:${event.params.skillId}`, worker: event.params.worker, skillId: event.params.skillId, txHash: event.transaction.hash });
});
indexer.onEvent({ contract: 'Reputation', event: 'CompletionRecorded' }, async ({ event, context }) => {
  const p = event.params;
  const empty = (id: string) => ({ id, completedTasks: 0, ratingSum: 0, totalEarned: 0n, totalSpent: 0n });
  const worker = await context.Score.get(p.worker) || empty(p.worker);
  const employer = await context.Score.get(p.employer) || empty(p.employer);
  context.Score.set({ ...worker, completedTasks: worker.completedTasks + 1, ratingSum: worker.ratingSum + Number(p.rating), totalEarned: worker.totalEarned + p.amount });
  context.Score.set({ ...employer, totalSpent: employer.totalSpent + p.amount });
});
