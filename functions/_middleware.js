// Cloudflare Pages: password gate for the whole site (proof of concept).
// The password is the Pages secret SITE_PASSWORD; any username is accepted.
export async function onRequest({ request, env, next }) {
  const want = env.SITE_PASSWORD;
  if (!want) return new Response('Site not configured', { status: 503 });
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Basic ')) {
    let pass = '';
    try { pass = atob(auth.slice(6)).split(':').slice(1).join(':'); } catch { /* malformed */ }
    if (pass === want) {
      const res = await next();
      const out = new Response(res.body, res);
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      out.headers.set('Cache-Control', 'private, max-age=300');
      return out;
    }
  }
  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="NB2420 logbooks", charset="UTF-8"' },
  });
}
