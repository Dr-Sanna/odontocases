// src/lib/strapi.js
const BASE_URL = import.meta.env.VITE_STRAPI_URL?.replace(/\/$/, '') || '';

function qs(params = {}) {
  const search = new URLSearchParams();

  const append = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    search.append(key, String(value));
  };

  const walk = (prefix, value) => {
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v && typeof v === 'object') walk(`${prefix}[${i}]`, v);
        else append(`${prefix}[${i}]`, v);
      });
      return;
    }

    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
      return;
    }

    append(prefix, value);
  };

  for (const [k, v] of Object.entries(params)) walk(k, v);

  const s = search.toString();
  return s ? `?${s}` : '';
}

export class StrapiFetchError extends Error {
  constructor(message, { status = 0, url = '', body = '' } = {}) {
    super(message);
    this.name = 'StrapiFetchError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 20;
}

export async function strapiFetch(path, { params, options = {} } = {}) {
  const url = `${BASE_URL}/api${path}${qs(params)}`;
  const method = String(options.method || 'GET').toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null;

  // Ne pas envoyer Content-Type: application/json sur les GET : sur une API
  // cross-origin, cela peut provoquer un preflight OPTIONS inutile.
  const headers = {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    method,
    // Les données Strapi doivent être revalidées par notre cache applicatif,
    // pas par un cache HTTP opaque du navigateur/proxy.
    cache: options.cache ?? (method === 'GET' ? 'no-store' : 'default'),
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StrapiFetchError(`Strapi ${res.status}: ${text || res.statusText}`, {
      status: res.status,
      url,
      body: text,
    });
  }

  return res.json();
}

export function imgUrl(media, format = 'thumbnail') {
  // Gère Strapi v4/v5: media.url absolue ou relative, + formats.
  if (!media) return '';
  const url = media.formats?.[format]?.url || media.url || '';
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${BASE_URL}${url}`;
}
