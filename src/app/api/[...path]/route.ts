import { getApi } from '@/server/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(request: Request) {
  const url = new URL(request.url);
  const api = getApi();
  const headers = Object.fromEntries(request.headers.entries());
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const result = await api.inject({ method: request.method as 'GET' | 'POST', url: url.pathname.replace(/^\/api/, '') + url.search, headers, payload: body || undefined });
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(result.headers)) if (value !== undefined && name !== 'content-length' && name !== 'transfer-encoding') {
    if (Array.isArray(value)) value.forEach(v => responseHeaders.append(name, String(v)));
    else responseHeaders.set(name, String(value));
  }
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(result.body, { status: result.statusCode, headers: responseHeaders });
}
export { handler as GET, handler as POST };
