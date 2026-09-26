export type IndexedTask = { id: string; employer: string; worker: string; requiredSkillId: string; amount: string; deadline: string; status: string; deliveryHash: string; reviewDeadline: string; rejections: number; reason: string; rating: number; txHash: string; createdAt: string };
export async function graph<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!process.env.INDEXER_GRAPHQL_URL) throw Object.assign(new Error('Indexer is not configured.'), { statusCode: 503 });
  const response = await fetch(process.env.INDEXER_GRAPHQL_URL, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(process.env.INDEXER_GRAPHQL_SECRET ? { 'x-hasura-admin-secret': process.env.INDEXER_GRAPHQL_SECRET } : {}) }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw Object.assign(new Error('Indexer is unavailable. Try again shortly.'), { statusCode: 503 });
  const result = await response.json();
  if (result.errors) throw Object.assign(new Error('Indexed data is not ready yet.'), { statusCode: 503 });
  return result.data;
}
const fields = 'id employer worker requiredSkillId amount deadline status deliveryHash reviewDeadline rejections reason rating txHash createdAt';
export async function indexedTasks() { return (await graph<{ Task: IndexedTask[] }>(`query { Task(order_by: {createdAt: desc}, limit: 500) { ${fields} } }`)).Task; }
export async function indexedTask(id: string) { return (await graph<{ Task: IndexedTask[] }>(`query($id: String!) { Task(where: {id: {_eq: $id}}) { ${fields} } }`, { id })).Task[0]; }
