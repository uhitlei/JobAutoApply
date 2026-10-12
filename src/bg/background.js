import { answerQuestions, manualPrompt, extractProfile, DEFAULT_MODELS } from './llm.js';
import * as vault from './vault.js';

const CONTENT_FILES = ['src/content/matcher.js', 'src/content/filler.js', 'src/content/linkedin.js', 'src/content/panel.js'];
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

const handlers = {
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
