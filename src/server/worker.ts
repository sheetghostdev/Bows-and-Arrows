import { ROOM_CODE } from '../shared/protocol';
import type { Env } from './room';

export { MatchRoom } from './room';

/**
 * Routes:
 *   /ws/<code>  -> that room's Durable Object (WebSocket)
 *   /, /m/<code> -> index.html with absolute link-preview URLs (Discord needs them)
 *   anything else -> static assets
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ws = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (ws) {
      const code = ws[1];
      if (!ROOM_CODE.test(code)) return new Response('Bad room code', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    if (url.pathname === '/' || /^\/m\/[a-z0-9]{4,12}\/?$/.test(url.pathname)) {
      const page = await env.ASSETS.fetch(new Request(new URL('/', url), req));
      return new HTMLRewriter()
        .on('meta[property="og:image"]', {
          element: (e) => {
            e.setAttribute('content', `${url.origin}/og.png`);
          },
        })
        .on('head', {
          element: (e) => {
            e.append(`<meta property="og:url" content="${url.origin}${url.pathname}" />`, { html: true });
          },
        })
        .transform(page);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
