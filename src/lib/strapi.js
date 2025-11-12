// src/lib/strapi.js
const BASE_URL = import.meta.env.VITE_STRAPI_URL?.replace(/\/$/, "") || "";


function qs(params = {}) {
const search = new URLSearchParams();
for (const [k, v] of Object.entries(params)) {
if (v === undefined || v === null || v === "") continue;
if (typeof v === "object" && !Array.isArray(v)) {
// Objet imbriqué → a[b][c]=
const stack = [[k, v]];
while (stack.length) {
const [prefix, obj] = stack.pop();
for (const [kk, vv] of Object.entries(obj)) {
if (vv && typeof vv === "object" && !Array.isArray(vv)) {
stack.push([`${prefix}[${kk}]`, vv]);
} else {
search.append(`${prefix}[${kk}]`, vv);
}
}
}
} else if (Array.isArray(v)) {
v.forEach((vv) => search.append(k, vv));
} else {
search.append(k, v);
}
}
const s = search.toString();
return s ? `?${s}` : "";
}


export async function strapiFetch(path, { params, options } = {}) {
const url = `${BASE_URL}/api${path}${qs(params)}`;
const res = await fetch(url, {
headers: { "Content-Type": "application/json" },
...options,
});
if (!res.ok) {
const text = await res.text().catch(() => "");
throw new Error(`Strapi ${res.status}: ${text || res.statusText}`);
}
return res.json();
}


export function imgUrl(media, format = "thumbnail") {
// Gère Strapi v4/v5: media.url absolue ou relative, + formats
if (!media) return "";
const url = media.formats?.[format]?.url || media.url || "";
if (!url) return "";
if (url.startsWith("http")) return url;
return `${BASE_URL}${url}`;
}