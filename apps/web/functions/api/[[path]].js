function normalizeBaseUrl(rawBaseUrl) {
  return (rawBaseUrl ?? '').trim().replace(/\/$/, '');
}

function resolveUpstreamUrl(baseUrl, requestUrl, path) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return null;
  }

  const apiRoot = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  const suffix = path ? `/${path}` : '';
  const upstream = new URL(`${apiRoot}${suffix}`);
  upstream.search = requestUrl.search;
  return upstream;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const upstreamUrl = resolveUpstreamUrl(
    env.API_BASE_URL || env.WORKER_API_URL,
    new URL(request.url),
    params?.path,
  );

  if (!upstreamUrl) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'API_BASE_URL_NOT_CONFIGURED',
          message:
            'Set the Pages environment variable API_BASE_URL to your deployed Worker URL, for example https://inventory-reservation-api.<subdomain>.workers.dev.',
        },
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      },
    );
  }

  const proxyRequest = new Request(upstreamUrl, request);
  return fetch(proxyRequest);
}
