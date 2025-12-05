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
      for (const [k, v] of Object.entries(value)) {
        walk(`${prefix}[${k}]`, v);
      }
      return;
    }

    append(prefix, value);
  };

  for (const [k, v] of Object.entries(params)) {
    walk(k, v);
  }

  const s = search.toString();
  return s ? `?${s}` : '';
}

export async function strapiFetch(path, { params, options } = {}) {
  const url = `${BASE_URL}/api${path}${qs(params)}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Strapi ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

export function imgUrl(media, format = 'thumbnail') {
  // Gère Strapi v4/v5: media.url absolue ou relative, + formats
  if (!media) return '';
  const url = media.formats?.[format]?.url || media.url || '';
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${BASE_URL}${url}`;
}
