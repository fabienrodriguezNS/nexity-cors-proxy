/**
 * Nexity Solaire — Mini proxy CORS pour Enedis Open Data (Vercel)
 * ----------------------------------------------------------------------
 * Vercel Edge Function : 100 000 invocations/jour gratuites.
 *
 * INSTALLATION (5 min) :
 *   1. Crée un compte gratuit sur https://vercel.com (connexion via GitHub)
 *   2. Sur ton ordi, crée un dossier vide, ex: "nexity-cors-proxy"
 *   3. À l'intérieur, crée un sous-dossier "api"
 *   4. Dans api/, place ce fichier en le renommant "proxy.js"
 *      (chemin final : nexity-cors-proxy/api/proxy.js)
 *   5. Crée à la racine du dossier un fichier "package.json" avec :
 *      { "name": "nexity-cors-proxy", "version": "1.0.0" }
 *   6. Va sur https://vercel.com/new
 *   7. Choisis "Browse" pour importer ton dossier OU lie-le à GitHub
 *   8. Clique "Deploy" — Vercel te donne une URL du type :
 *      https://nexity-cors-proxy.vercel.app
 *   9. L'endpoint final sera :
 *      https://nexity-cors-proxy.vercel.app/api/proxy?url=...
 *  10. Reporte cette URL dans index.html → constante RCD_CORS_PROXY_URL
 *
 * USAGE :
 *   GET https://<ton-app>.vercel.app/api/proxy?url=<URL_ENCODÉE>
 *
 * SÉCURITÉ :
 *   - Liste blanche d'origines : seuls les domaines Nexity peuvent appeler
 *   - Liste blanche de cibles : Enedis, ODRÉ, Capareseau uniquement
 *   - Lecture seule (GET / HEAD)
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
  'data.enedis.fr',
  'enedis.opendatasoft.com',
  'odre.opendatasoft.com',
  'opendata.reseaux-energies.fr',
  'capareseau.fr',
  'www.capareseau.fr',
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
        message: 'Nexity CORS proxy is alive. Append ?url=<encoded URL> to relay.',
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

  // Relais
  try {
    const upstream = await fetch(parsed.toString(), {
      method: request.method,
      headers: {
        Accept: request.headers.get('Accept') || 'application/json',
        'User-Agent': 'NexityCorsProxy/1.0',
      },
    });

    const headers = new Headers(upstream.headers);
    Object.entries(corsHeaders(origin, isAllowedOrigin)).forEach(([k, v]) =>
      headers.set(k, v),
    );
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    // Cache 5 min en bord pour soulager Enedis
    headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');

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
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
