// licence.js — LemonSqueezy licence key management for DentaVet
// Handles: activation, validation, deactivation, trial management, tamper detection

const LEMON_API = 'https://api.lemonsqueezy.com/v1/licenses';
const STORAGE_KEY = 'dentavet_licence';
const TRIAL_DAYS = 30;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
const OFFLINE_GRACE_DAYS = 7;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
const HASH_SALT = 'DentaVet2026!xK9pL3m';

// ── Storage helpers ──────────────────────────────────────────────────────

function defaultLicenceData() {
  return {
    licenceKey: null,
    instanceId: null,
    instanceName: null,
    status: 'inactive',        // 'active' | 'trial' | 'expired' | 'inactive'
    activatedAt: null,
    lastValidated: null,
    trialStarted: null,
    validationHash: null,
  };
}

async function readStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      resolve(res[STORAGE_KEY] || defaultLicenceData());
    });
  });
}

async function writeStorage(data) {
  data.validationHash = await computeHash(data);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
  });
}

// ── Tamper detection ─────────────────────────────────────────────────────

async function computeHash(data) {
  const raw = `${HASH_SALT}|${data.licenceKey}|${data.instanceId}|${data.status}|${data.activatedAt}|${data.trialStarted}`;
  const encoded = new TextEncoder().encode(raw);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyHash(data) {
  if (!data.validationHash) return false;
  const expected = await computeHash(data);
  return data.validationHash === expected;
}

// ── Instance name (device fingerprint) ───────────────────────────────────

async function getOrCreateInstanceName() {
  const data = await readStorage();
  if (data.instanceName) return data.instanceName;

  // Generate a semi-unique identifier for this browser/profile
  const raw = `${navigator.userAgent}|${chrome.runtime.id}|${Date.now()}|${Math.random()}`;
  const encoded = new TextEncoder().encode(raw);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const name = 'DV-' + Array.from(new Uint8Array(buffer)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

  data.instanceName = name;
  await writeStorage(data);
  return name;
}

// ── LemonSqueezy API calls ───────────────────────────────────────────────

export async function activateLicence(key) {
  try {
    const instanceName = await getOrCreateInstanceName();
    const res = await fetch(`${LEMON_API}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ license_key: key, instance_name: instanceName }),
    });
    const json = await res.json();

    if (json.activated || json.valid) {
      const data = await readStorage();
      data.licenceKey = key;
      data.instanceId = json.instance?.id || json.instance_id || null;
      data.status = 'active';
      data.activatedAt = new Date().toISOString();
      data.lastValidated = new Date().toISOString();
      await writeStorage(data);
      return { ok: true, data: json };
    }

    return { ok: false, error: json.error || json.message || 'Activation failed. Check your licence key.' };
  } catch (err) {
    return { ok: false, error: 'Network error — please check your internet connection.' };
  }
}

export async function validateLicence() {
  const data = await readStorage();
  if (!data.licenceKey || !data.instanceId) return { ok: false, status: data.status };

  try {
    const res = await fetch(`${LEMON_API}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ license_key: data.licenceKey, instance_id: data.instanceId }),
    });
    const json = await res.json();

    if (json.valid) {
      data.status = 'active';
      data.lastValidated = new Date().toISOString();
      await writeStorage(data);
      return { ok: true, status: 'active', meta: json.meta || json };
    }

    // Licence revoked or invalid
    data.status = 'inactive';
    await writeStorage(data);
    return { ok: false, status: 'inactive', error: json.error || 'Licence is no longer valid.' };
  } catch (err) {
    // Offline — use grace period
    if (data.lastValidated) {
      const elapsed = Date.now() - new Date(data.lastValidated).getTime();
      if (elapsed < OFFLINE_GRACE_MS) {
        return { ok: true, status: 'active', offline: true };
      }
    }
    return { ok: false, status: 'inactive', error: 'Could not validate licence — offline too long.' };
  }
}

export async function deactivateLicence() {
  const data = await readStorage();
  if (!data.licenceKey || !data.instanceId) {
    return { ok: false, error: 'No active licence to deactivate.' };
  }

  try {
    const res = await fetch(`${LEMON_API}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ license_key: data.licenceKey, instance_id: data.instanceId }),
    });
    const json = await res.json();

    if (json.deactivated) {
      const fresh = defaultLicenceData();
      fresh.instanceName = data.instanceName; // keep device fingerprint
      await writeStorage(fresh);
      return { ok: true };
    }

    return { ok: false, error: json.error || json.message || 'Deactivation failed.' };
  } catch (err) {
    return { ok: false, error: 'Network error — please check your internet connection.' };
  }
}

// ── Trial management ─────────────────────────────────────────────────────

export async function initTrial() {
  const data = await readStorage();
  if (!data.trialStarted) {
    data.trialStarted = new Date().toISOString();
    data.status = 'trial';
    await writeStorage(data);
  }
  return data;
}

export function isTrialExpired(trialStarted) {
  if (!trialStarted) return true;
  return (Date.now() - new Date(trialStarted).getTime()) > TRIAL_MS;
}

export function trialDaysRemaining(trialStarted) {
  if (!trialStarted) return 0;
  const elapsed = Date.now() - new Date(trialStarted).getTime();
  const remaining = Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

// ── Main state resolver ──────────────────────────────────────────────────

export async function getLicenceState() {
  const data = await readStorage();

  // Tamper check
  const hashOk = await verifyHash(data);
  if (data.status === 'active' && !hashOk) {
    // Tampered — force revalidation
    data.status = 'inactive';
    await writeStorage(data);
    return { ...data, status: 'inactive', tampered: true };
  }

  // Active licence
  if (data.status === 'active') {
    return { ...data };
  }

  // Trial
  if (data.status === 'trial' || data.trialStarted) {
    if (isTrialExpired(data.trialStarted)) {
      data.status = 'expired';
      await writeStorage(data);
      return { ...data, status: 'expired', daysRemaining: 0 };
    }
    return {
      ...data,
      status: 'trial',
      daysRemaining: trialDaysRemaining(data.trialStarted),
    };
  }

  // Not activated, no trial
  return { ...data, status: 'inactive' };
}
