import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { createApi } from '../src/server/api';
import { summarizeReviews } from '../src/lib/reviews';
import { deliverySchema, profileSchema, reviewInputSchema, safeExternalUrl, taskInputSchema, validate, walletAddress } from '../src/lib/validators';

test('shared validators accept valid input and explain invalid input', () => {
  const deadline = Math.floor(Date.now() / 1000) + 7 * 86400;
  assert.equal(validate(taskInputSchema, { title: 'Review a staking vault', description: 'Review accounting and reentrancy risks with tests.', category: 'Security', level: 'expert', amount: '12.5', deadline }).amount, '12.5');
  assert.throws(() => validate(taskInputSchema, { title: 'Review a staking vault', description: 'Review accounting and reentrancy risks with tests.', category: 'Security', level: 'expert', amount: '0', deadline }), /greater than 0/);
  assert.throws(() => validate(deliverySchema, { url: 'http://example.com' }), /HTTPS/);
  assert.throws(() => validate(deliverySchema, { url: 'javascript:alert(1)' }), /HTTPS/);
  assert.throws(() => validate(reviewInputSchema, { rating: 6, comment: 'Great collaboration overall.' }), /1 to 5/);
  assert.throws(() => validate(reviewInputSchema, { rating: 5, comment: 'ok' }), /at least 10/);
  assert.throws(() => validate(profileSchema, { name: '<script>' }), /letters, numbers/);
  assert.equal(validate(walletAddress, getAddress('0xabcdef0123456789abcdef0123456789abcdef01')), '0xabcdef0123456789abcdef0123456789abcdef01');
  assert.throws(() => validate(walletAddress, '0x1234'), /Invalid wallet address/);
  assert.equal(safeExternalUrl('https://monad.xyz'), 'https://monad.xyz');
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('/#board'), undefined);
});

test('review summary computes average and distribution', () => {
  const base = { taskId: '1', taskTitle: 'T', from: '0x1', fromName: 'A', to: '0x2', fromRole: 'employer' as const, comment: 'Solid delivery overall.', createdAt: 0 };
  const summary = summarizeReviews([{ ...base, id: 'a', rating: 5 }, { ...base, id: 'b', rating: 4 }, { ...base, id: 'c', rating: 5 }]);
  assert.equal(summary.count, 3); assert.equal(summary.average.toFixed(2), '4.67'); assert.equal(summary.distribution[5], 2); assert.equal(summary.distribution[1], 0);
});

test('API validates review input and task ids before touching chain or database', async () => {
  const api = createApi();
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://quark.example';
  try {
    const badId = await api.inject({ method: 'POST', url: '/tasks/abc/review', headers: { origin: 'https://quark.example' }, payload: { rating: 5, comment: 'Great collaboration overall.' } });
    assert.equal(badId.statusCode, 400); assert.match(badId.json().error, /Invalid task id/);
    const signedOut = await api.inject({ method: 'POST', url: '/tasks/1/review', headers: { origin: 'https://quark.example' }, payload: { rating: 5, comment: 'Great collaboration overall.' } });
    assert.equal(signedOut.statusCode, 401);
    const badAddress = await api.inject({ method: 'GET', url: '/reviews/not-an-address' });
    assert.equal(badAddress.statusCode, 400);
  } finally { process.env.APP_ORIGIN = previous; await api.close(); }
});
