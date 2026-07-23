// src/lib/trainingStatsStore.js
import { useCallback, useSyncExternalStore } from 'react';
import { strapiFetch } from './strapi';

const CASES_ENDPOINT = import.meta.env.VITE_CASES_ENDPOINT || '/cases';

// Pendant cette durée, aucune requête de contrôle n'est nécessaire.
const FRESH_MS = Number(import.meta.env.VITE_TRAINING_STATS_STALE_MS) || 5 * 60_000;

// Une ancienne valeur reste utilisable immédiatement pendant la revalidation.
// Au-delà, elle est ignorée pour éviter d'afficher un compteur très obsolète.
const MAX_AGE_MS = Number(import.meta.env.VITE_TRAINING_STATS_MAX_AGE_MS) || 30 * 24 * 60 * 60_000;

const STORAGE_VERSION = 1;

const store = {
  // publicationState -> { hydrated, quizCount, at, listeners }
  byPub: new Map(),
  inflight: new Map(),
};

function storageKey(publicationState) {
  return `odontocases:training-stats:v${STORAGE_VERSION}:${publicationState}`;
}

function createBucket() {
  return {
    hydrated: false,
    quizCount: null,
    at: 0,
    listeners: new Set(),
  };
}

function hydrateBucket(bucket, publicationState) {
  if (bucket.hydrated) return bucket;
  bucket.hydrated = true;

  if (typeof window === 'undefined') return bucket;

  try {
    const raw = window.localStorage.getItem(storageKey(publicationState));
    if (!raw) return bucket;

    const parsed = JSON.parse(raw);
    const at = Number(parsed?.at) || 0;
    const quizCount = Number(parsed?.quizCount);

    if (!at || Date.now() - at > MAX_AGE_MS || !Number.isFinite(quizCount) || quizCount < 0) {
      window.localStorage.removeItem(storageKey(publicationState));
      return bucket;
    }

    bucket.at = at;
    bucket.quizCount = quizCount;
  } catch {
    // Un cache illisible ne doit jamais empêcher l'affichage de l'application.
  }

  return bucket;
}

function ensureBucket(publicationState) {
  if (!store.byPub.has(publicationState)) {
    store.byPub.set(publicationState, createBucket());
  }

  return hydrateBucket(store.byPub.get(publicationState), publicationState);
}

function bucketAge(bucket) {
  return bucket?.at ? Date.now() - bucket.at : Number.POSITIVE_INFINITY;
}

function persistBucket(bucket, publicationState) {
  if (typeof window === 'undefined' || bucket.quizCount === null) return;

  try {
    window.localStorage.setItem(
      storageKey(publicationState),
      JSON.stringify({
        version: STORAGE_VERSION,
        at: bucket.at,
        quizCount: bucket.quizCount,
      })
    );
  } catch {
    // localStorage indisponible ou plein : le cache mémoire continue de fonctionner.
  }
}

function notify(bucket) {
  bucket.listeners.forEach((listener) => listener());
}

export function getQuizCount({ publicationState = 'live' } = {}) {
  return ensureBucket(publicationState).quizCount;
}

export function subscribeTrainingStats(listener, { publicationState = 'live' } = {}) {
  const bucket = ensureBucket(publicationState);
  bucket.listeners.add(listener);
  return () => bucket.listeners.delete(listener);
}

export function useQuizCount({ publicationState = 'live' } = {}) {
  const subscribe = useCallback(
    (listener) => subscribeTrainingStats(listener, { publicationState }),
    [publicationState]
  );

  const getSnapshot = useCallback(
    () => getQuizCount({ publicationState }),
    [publicationState]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function isTrainingStatsFresh({ publicationState = 'live', maxAgeMs = FRESH_MS } = {}) {
  const bucket = ensureBucket(publicationState);
  return bucket.quizCount !== null && bucketAge(bucket) <= maxAgeMs;
}

export function invalidateTrainingStats({ publicationState = 'live', clear = false } = {}) {
  const bucket = ensureBucket(publicationState);
  bucket.at = 0;

  if (clear) {
    const changed = bucket.quizCount !== null;
    bucket.quizCount = null;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey(publicationState));
      } catch {}
    }

    if (changed) notify(bucket);
  }
}

async function refreshTrainingStats({
  publicationState = 'live',
  signal,
  force = false,
  maxAgeMs = FRESH_MS,
} = {}) {
  const bucket = ensureBucket(publicationState);

  if (!force && bucket.quizCount !== null && bucketAge(bucket) <= maxAgeMs) {
    return bucket.quizCount;
  }

  if (store.inflight.has(publicationState)) {
    return store.inflight.get(publicationState);
  }

  const promise = (async () => {
    const data = await strapiFetch(CASES_ENDPOINT, {
      params: {
        locale: 'all',
        publicationState,
        filters: { type: { $eq: 'quiz' } },
        fields: ['slug'],
        pagination: { page: 1, pageSize: 1 },
      },
      options: signal ? { signal } : undefined,
    });

    const nextCount = Number(data?.meta?.pagination?.total);
    if (!Number.isFinite(nextCount) || nextCount < 0) {
      throw new Error("Le total des quiz renvoyé par Strapi est invalide.");
    }

    const changed = bucket.quizCount !== nextCount;
    bucket.quizCount = nextCount;
    bucket.at = Date.now();
    persistBucket(bucket, publicationState);

    // Une simple revalidation avec le même total ne provoque aucun rendu React.
    if (changed) notify(bucket);

    return nextCount;
  })();

  store.inflight.set(publicationState, promise);

  try {
    return await promise;
  } finally {
    store.inflight.delete(publicationState);
  }
}

/** Premier chargement ou revalidation si le cache n'est plus frais. */
export function primeTrainingStats(opts = {}) {
  return refreshTrainingStats(opts);
}

/** Revalidation explicite, toujours dédupliquée et silencieuse si le total ne change pas. */
export function revalidateTrainingStats(opts = {}) {
  return refreshTrainingStats(opts);
}
