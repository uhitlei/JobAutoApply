// Cofre das chaves de API: AES-GCM com chave derivada da senha mestra (PBKDF2).
// No disco (chrome.storage.local) só fica o texto cifrado. A chave derivada fica em
// chrome.storage.session, que vive só em memória e é apagada quando o navegador fecha.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 600000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(data) };
}

async function decrypt(key, { iv, data }) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data));
    return JSON.parse(dec.decode(plain));
  } catch (e) {
    throw new Error('Senha mestra incorreta.');
  }
}

async function storedVault() { return (await chrome.storage.local.get('vault')).vault || null; }

async function sessionKey() {
  const { vaultKey } = await chrome.storage.session.get('vaultKey');
  if (!vaultKey) return null;
  return crypto.subtle.importKey('raw', unb64(vaultKey), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function keepInSession(key) {
  await chrome.storage.session.set({ vaultKey: b64(await crypto.subtle.exportKey('raw', key)) });
}

const clean = (keys) => ({ anthropicKey: String(keys?.anthropicKey || '').trim(), openaiKey: String(keys?.openaiKey || '').trim() });

export async function status() {
  const vault = await storedVault();
  return { configured: !!vault, unlocked: !!vault && !!(await sessionKey()) };
}

export async function create(password, keys) {
  if (!password || password.length < 8) throw new Error('A senha mestra precisa ter pelo menos 8 caracteres.');
  if (await storedVault()) throw new Error('O cofre já existe. Desbloqueie para alterar as chaves.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const vault = { v: 1, salt: b64(salt), iterations: ITERATIONS, ...(await encrypt(key, clean(keys))) };
  await chrome.storage.local.set({ vault });
  await chrome.storage.local.remove('legacyKeys');
  await keepInSession(key);
}

export async function unlock(password) {
  const vault = await storedVault();
  if (!vault) throw new Error('Nenhum cofre configurado.');
  const key = await deriveKey(password, unb64(vault.salt));
  await decrypt(key, vault); // valida a senha
  await keepInSession(key);
}

export async function lock() { await chrome.storage.session.remove('vaultKey'); }

// Chaves em texto claro. Lança erro se não houver cofre ou se estiver bloqueado.
export async function getKeys() {
  const vault = await storedVault();
  if (!vault) throw new Error('Nenhuma chave de API cadastrada. Crie o cofre nas configurações.');
  const key = await sessionKey();
  if (!key) throw new Error('Cofre bloqueado. Abra o popup da extensão e digite a senha mestra.');
  return decrypt(key, vault);
}

export async function setKeys(keys) {
  const vault = await storedVault();
  const key = await sessionKey();
  if (!vault || !key) throw new Error('Desbloqueie o cofre antes de alterar as chaves.');
  await chrome.storage.local.set({ vault: { ...vault, ...(await encrypt(key, clean(keys))) } });
}

export async function changePassword(oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
  const vault = await storedVault();
  if (!vault) throw new Error('Nenhum cofre configurado.');
  const oldKey = await deriveKey(oldPassword, unb64(vault.salt));
  const keys = await decrypt(oldKey, vault);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(newPassword, salt);
  await chrome.storage.local.set({ vault: { v: 1, salt: b64(salt), iterations: ITERATIONS, ...(await encrypt(newKey, keys)) } });
  await keepInSession(newKey);
}

export async function remove() {
  await chrome.storage.local.remove('vault');
  await lock();
}
