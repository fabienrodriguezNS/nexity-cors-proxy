/**
 * Nexity Solaire — Mini proxy CORS v2 (Vercel Edge Function)
 * ----------------------------------------------------------------------
 * v2 ajoute :
 *   - Support GitHub Releases (github.com → objects.githubusercontent.com)
 *   - Suivi des redirections 302 (sinon le navigateur bloque sur le preflight)
 *   - Streaming des gros fichiers (>100 Mo) sans saturer la mémoire Vercel
 * ----------------------------------------------------------------------
 */

export const config = {
  runtime: 'edge',
};

// ═══════ CONFIGURATION ═══════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://fabienrodriguezns.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null',
];

const ALLOWED_TARGETS = [
  // Données publiques Enedis / ODRÉ
  'data.enedis.fr',
  'enedis.opendatasoft.com',
  'odre.opendatasoft.com',
  'opendata.reseaux-energies.fr',
  // Capacités d'accueil
  'capareseau.fr',
  'www.capareseau.fr',
  // GitHub Releases (assets binaires)
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
];

// ═══════ HANDLER ═════════════════════════════════════════════════════════

export default async function handler(request) {
  const origin = request.headers.get('Origin') || '';
  const isAllowedOrigin =
    ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o));

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin, isAllowedOrigin),
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Lire l'URL cible
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(
      JSON.stringify({
        ok: true,
        version: '2.0',
        message: 'Nexity CORS proxy is alive. Append ?url=<encoded URL> to relay.',
        allowedTargets: ALLOWED_TARGETS,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin, isAllowedOrigin),
        },
      },
    );
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }

  if (!ALLOWED_TARGETS.includes(parsed.hostname)) {
    return new Response(
      `Target host not allowed: ${parsed.hostname}`,
      { status: 403 },
    );
  }

  // Relais (avec suivi de redirection — important pour GitHub Releases)
  try {
    const upstream = await fetch(parsed.toString(), {
      method: request.method,
      redirect: 'follow',          // ← clé : on suit les 302 vers objects.githubusercontent.com
      headers: {
        Accept: request.headers.get('Accept') || '*/*',
        'User-Agent': 'NexityCorsProxy/2.0',
      },
    });

    // Recopier les en-têtes utiles, sans les hop-by-hop
    const headers = new Headers();
    const passthrough = ['content-type', 'content-length', 'content-encoding',
                         'last-modified', 'etag', 'accept-ranges'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    // CORS
    Object.entries(corsHeaders(origin, isAllowedOrigin)).forEach(([k, v]) =>
      headers.set(k, v),
    );
    // Cache long pour les Releases (immuables par tag)
    if (parsed.hostname === 'github.com' || parsed.hostname === 'objects.githubusercontent.com') {
      headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    } else {
      headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/octet-stream');
    }

    // Important : on streame le body sans .arrayBuffer() qui chargerait tout
    // en mémoire (risque OOM sur Vercel Edge pour 401 Mo).
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Proxy fetch failed', detail: String(e) }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin, isAllowedOrigin),
        },
      },
    );
  }
}

function corsHeaders(origin, isAllowed) {
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
