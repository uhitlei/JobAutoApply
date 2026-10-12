import { answerQuestions, manualPrompt, extractProfile, DEFAULT_MODELS } from './llm.js';
import * as vault from './vault.js';

const CONTENT_FILES = ['src/content/matcher.js', 'src/content/filler.js', 'src/content/linkedin.js', 'src/content/generic.js', 'src/content/panel.js'];
const FRAME_FILES = CONTENT_FILES.slice(0, 2);

const DEFAULT_SETTINGS = {
  aiMode: 'off', // 'off' | 'api' | 'manual'
  provider: 'anthropic',
  anthropicModel: DEFAULT_MODELS.anthropic, openaiModel: DEFAULT_MODELS.openai,
  manualChat: 'https://claude.ai/new',
  autoSubmit: false, uploadOnLinkedIn: false,
  maxPerRun: 10, delayMin: 4, delayMax: 9,
};

async function getAll() {
  const s = await chrome.storage.local.get(['profile', 'settings', 'answers', 'resumes', 'linkedinText', 'log']);
  return {
    profile: s.profile || {},
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    answers: s.answers || {},
    resumes: s.resumes || [],
    linkedinText: s.linkedinText || '',
    log: s.log || [],
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Escolhe o currículo cujas palavras-chave mais aparecem no texto da vaga; senão, o padrão.
function pickResume(resumes, jobText) {
  if (!resumes.length) return null;
  const text = norm(jobText);
  let best = null, bestScore = 0;
  for (const r of resumes) {
    const kws = String(r.keywords || '').split(',').map((k) => norm(k).trim()).filter(Boolean);
    const score = kws.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best || resumes.find((r) => r.isDefault) || resumes[0];
}

// Configurações com as chaves de API vindas do cofre. Lança erro se o cofre estiver bloqueado.
async function settingsWithKeys(settings) {
  return { ...settings, ...(await vault.getKeys()) };
}

async function aiContext(msg) {
  const s = await getAll();
  const resume = pickResume(s.resumes, `${msg.job?.title} ${msg.job?.description}`);
  return { settings: await settingsWithKeys(s.settings), ctx: { profile: s.profile, resumeText: resume?.text || '', linkedinText: s.linkedinText, answers: s.answers, questions: msg.questions, job: msg.job } };
}

async function inject(tabId, files, allFrames) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames }, files });
}

async function inFrames(tabId, func, args) {
  await inject(tabId, FRAME_FILES, true).catch(() => {});
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args: args || [] });
  return results.map((r) => r.result).filter(Boolean);
}

async function openPanel(tabId) {
  await inject(tabId, FRAME_FILES, true).catch(() => {});
  await inject(tabId, CONTENT_FILES, false);
}

// ---- Fila de links ----
// Estado em chrome.storage.local para sobreviver ao encerramento do service worker.
const DONE = new Set(['enviada', 'pulada', 'erro', 'concluída']);
async function getQueue() { return (await chrome.storage.local.get('queue')).queue || { items: [], running: false, tabId: null }; }
async function setQueue(q) { await chrome.storage.local.set({ queue: q }); }
const current = (q) => q.items.find((i) => i.status === 'em andamento' || i.status === 'pronta para revisão');

async function queueOpenNext() {
  const q = await getQueue();
  if (!q.running) return;
  const item = q.items.find((i) => i.status === 'pendente');
  if (!item) { q.running = false; q.tabId = null; await setQueue(q); return; }
  item.status = 'em andamento'; item.loads = 0; item.note = '';
  const tab = q.tabId ? await chrome.tabs.get(q.tabId).catch(() => null) : null;
  if (tab) await chrome.tabs.update(tab.id, { url: item.url, active: true });
  else q.tabId = (await chrome.tabs.create({ url: item.url, active: true })).id;
  await setQueue(q);
}

async function queueScheduleNext() {
  const { settings } = await getAll();
  const secs = settings.delayMin + Math.random() * Math.max(0, settings.delayMax - settings.delayMin);
  // Alarme em vez de setTimeout: o service worker pode ser encerrado durante a pausa.
  chrome.alarms.create('queue-next', { delayInMinutes: Math.max(secs, 1) / 60 });
}

async function queueFinish(status, note) {
  const q = await getQueue();
  const item = current(q);
  if (!item) return;
  item.status = status; item.note = note || item.note || '';
  if (status === 'parada') { item.status = 'pendente'; q.running = false; }
  await setQueue(q);
  if (DONE.has(status)) await queueScheduleNext();
}

async function stopContent(tabId) {
  if (!tabId) return;
  await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__JAA?.linkedin?.stop() }).catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const q = await getQueue();
  if (!q.running || tabId !== q.tabId) return;
  const item = q.items.find((i) => i.status === 'em andamento');
  if (!item) return;
  item.loads = (item.loads || 0) + 1;
  if (item.loads > 4) { item.status = 'erro'; item.note = 'a página recarregou vezes demais'; await setQueue(q); return queueScheduleNext(); }
  await setQueue(q);
  const { settings } = await getAll();
  try {
    await openPanel(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, func: (args) => { window.__JAA.queue.runItem(args); }, args: [{ item: { url: item.url, index: q.items.indexOf(item) }, total: q.items.length, settings }] });
  } catch (e) {
    await queueFinish('erro', e.message);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const q = await getQueue();
  if (tabId !== q.tabId) return;
  const item = current(q);
  if (item && item.status === 'em andamento') item.status = 'pendente';
  q.running = false; q.tabId = null;
  await setQueue(q);
});

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'queue-next') queueOpenNext(); });

const handlers = {
  async 'queue.get'() { return getQueue(); },
  async 'queue.set'(msg) {
    const q = await getQueue();
    const old = new Map(q.items.map((i) => [i.url, i]));
    const urls = [...new Set(String(msg.text || '').split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)))];
    q.items = urls.map((url) => old.get(url) || { url, status: 'pendente', note: '' });
    await setQueue(q);
    return q;
  },
  async 'queue.start'() {
    const q = await getQueue();
    for (const i of q.items) if (i.status === 'em andamento' || i.status === 'pronta para revisão') i.status = 'pendente';
    q.running = true;
    await setQueue(q);
    await queueOpenNext();
    return getQueue();
  },
  async 'queue.stop'() {
    const q = await getQueue();
    await stopContent(q.tabId);
    chrome.alarms.clear('queue-next');
    for (const i of q.items) if (i.status === 'em andamento' || i.status === 'pronta para revisão') i.status = 'pendente';
    q.running = false;
    await setQueue(q);
    return q;
  },
  async 'queue.result'(msg, sender) {
    const q = await getQueue();
    if (sender.tab && sender.tab.id !== q.tabId) return { ok: false };
    await queueFinish(msg.status, msg.note);
    return { ok: true };
  },
  async 'queue.next'() { await queueFinish('concluída'); return { ok: true }; },
  async 'queue.skip'() { const q = await getQueue(); await stopContent(q.tabId); await queueFinish('pulada', 'pulada por você'); return { ok: true }; },
  async 'queue.clearDone'() { const q = await getQueue(); q.items = q.items.filter((i) => !DONE.has(i.status)); await setQueue(q); return q; },
  async 'queue.reset'() { const q = await getQueue(); for (const i of q.items) { i.status = 'pendente'; i.note = ''; } await setQueue(q); return q; },
  async 'state.get'() {
    const s = await getAll();
    // Páginas nunca recebem as chaves de API: elas só saem do cofre dentro deste service worker.
    return { profile: s.profile, settings: s.settings, answers: s.answers };
  },
  async 'resume.pick'(msg) {
    const { resumes } = await getAll();
    const r = pickResume(resumes, msg.jobText);
    return r ? { fileName: r.fileName, mime: r.mime, dataB64: r.dataB64, name: r.name } : {};
  },
  async 'ai.answer'(msg) {
    const { settings, ctx } = await aiContext(msg);
    return { answers: await answerQuestions(settings, ctx) };
  },
  async 'ai.prompt'(msg) {
    // Modo manual não precisa das chaves, então não exige o cofre aberto.
    const s = await getAll();
    const resume = pickResume(s.resumes, `${msg.job?.title} ${msg.job?.description}`);
    const ctx = { profile: s.profile, resumeText: resume?.text || '', linkedinText: s.linkedinText, answers: s.answers, questions: msg.questions, job: msg.job };
    return { prompt: manualPrompt(ctx), chatUrl: s.settings.manualChat };
  },
  async 'ai.extract'(msg) {
    const { settings } = await getAll();
    return extractProfile(await settingsWithKeys(settings), msg);
  },
  async 'vault.status'() { return vault.status(); },
  async 'vault.create'(msg) { await vault.create(msg.password, msg.keys); return { ok: true }; },
  async 'vault.unlock'(msg) { await vault.unlock(msg.password); return { ok: true }; },
  async 'vault.lock'() { await vault.lock(); return { ok: true }; },
  async 'vault.getKeys'() { return vault.getKeys(); },
  async 'vault.setKeys'(msg) { await vault.setKeys(msg.keys); return { ok: true }; },
  async 'vault.changePassword'(msg) { await vault.changePassword(msg.oldPassword, msg.newPassword); return { ok: true }; },
  async 'vault.remove'() { await vault.remove(); return { ok: true }; },
  async 'answers.learn'(msg) {
    const { answers } = await getAll();
    await chrome.storage.local.set({ answers: { ...answers, ...msg.learned } });
    return { ok: true };
  },
  async 'log.add'(msg) {
    const { log } = await getAll();
    log.unshift({ date: new Date().toISOString(), title: msg.entry.title, company: msg.entry.company, url: msg.entry.url, status: msg.entry.status });
    await chrome.storage.local.set({ log: log.slice(0, 500) });
    return { ok: true };
  },
  async 'options.open'() { chrome.runtime.openOptionsPage(); return { ok: true }; },
  async 'panel.open'(msg) { await openPanel(msg.tabId); return { ok: true }; },
  async 'tab.fill'(msg, sender) {
    const tabId = msg.tabId || sender.tab.id;
    const { settings } = await getAll();
    const parts = await inFrames(tabId, () => window.__JAA.fillPage());
    const total = { filled: 0, ai: 0, files: [], pending: [], aiMode: settings.aiMode };
    for (const p of parts) {
      if (p.error) { total.error = p.error; continue; }
      total.filled += p.filled; total.ai += p.ai; total.files.push(...p.files); total.pending.push(...p.pending);
      if (p.aiError) total.aiError = p.aiError;
    }
    if (total.error && (total.filled || total.pending.length)) delete total.error;
    return total;
  },
  async 'tab.applyAnswers'(msg, sender) {
    const counts = await inFrames(sender.tab.id, (a) => window.__JAA.applyAnswers(a), [msg.answers]);
    return { count: counts.reduce((a, b) => a + b, 0) };
  },
  async 'tab.learn'(msg, sender) {
    const counts = await inFrames(sender.tab.id, () => window.__JAA.learn());
    return { count: counts.reduce((a, b) => a + b, 0) };
  },
  async 'linkedin.scrape'(msg) {
    await inject(msg.tabId, CONTENT_FILES.slice(0, 3), false);
    const [r] = await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: () => window.__JAA.linkedin.scrapeProfile() });
    if (r?.result?.text) await chrome.storage.local.set({ linkedinText: r.result.text });
    return r?.result || {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg, sender).then(sendResponse, (e) => sendResponse({ error: e.message || String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await openPanel(tab.id);
  await handlers['tab.fill']({ tabId: tab.id }, {});
});

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
  // Versões anteriores guardavam as chaves em texto claro dentro de settings. Tira de lá
  // e deixa à espera para serem cifradas quando o cofre for criado.
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && (settings.anthropicKey || settings.openaiKey)) {
    const { anthropicKey = '', openaiKey = '', ...rest } = settings;
    await chrome.storage.local.set({ settings: rest, legacyKeys: { anthropicKey, openaiKey } });
  }
});
