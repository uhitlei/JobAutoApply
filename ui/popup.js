const $ = (id) => document.getElementById(id);
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const msg = (t) => ($('msg').textContent = t);

async function openPanel() {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) { msg('Abra a página de uma vaga para usar.'); return null; }
  const r = await chrome.runtime.sendMessage({ type: 'panel.open', tabId: tab.id });
  if (r?.error) { msg(r.error); return null; }
  return tab;
}

$('panel').onclick = async () => { if (await openPanel()) window.close(); };
$('options').onclick = () => chrome.runtime.openOptionsPage();
$('fill').onclick = async () => {
  const tab = await openPanel();
  if (!tab) return;
  msg('Preenchendo…');
  const r = await chrome.runtime.sendMessage({ type: 'tab.fill', tabId: tab.id });
  if (!r || r.error) return msg(r?.error || 'Falha ao preencher.');
  msg(`${r.filled + r.ai} campo(s) preenchido(s), ${r.pending.length} sem resposta. Revise antes de enviar.`);
};

async function renderVault(settings) {
  const st = await chrome.runtime.sendMessage({ type: 'vault.status' });
  const needs = settings.aiMode === 'api';
  $('vault').hidden = !(needs && st?.configured && !st.unlocked);
  $('vault-lock').hidden = !st?.unlocked;
  if (needs && !st?.configured) msg('IA automática ligada, mas sem chaves cadastradas. Crie o cofre nas configurações.');
}
$('vault-unlock').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: 'vault.unlock', password: $('vault-pass').value });
  if (r?.error) return msg(r.error);
  $('vault-pass').value = '';
  msg('Chaves desbloqueadas até fechar o navegador.');
  const { settings = {} } = await chrome.storage.local.get('settings');
  renderVault(settings);
};
$('vault-pass').onkeydown = (e) => { if (e.key === 'Enter') $('vault-unlock').click(); };
$('vault-lock').onclick = async () => { await chrome.runtime.sendMessage({ type: 'vault.lock' }); msg('Chaves bloqueadas.'); const { settings = {} } = await chrome.storage.local.get('settings'); renderVault(settings); };

(async () => {
  const { profile = {}, resumes = [], settings = {} } = await chrome.storage.local.get(['profile', 'resumes', 'settings']);
  const ai = { api: 'IA automática', manual: 'IA manual', off: 'IA desligada' }[settings.aiMode || 'off'];
  $('summary').textContent = profile.email ? `${profile.fullName || profile.email} · ${resumes.length} currículo(s) · ${ai}` : 'Comece preenchendo seu perfil nas configurações.';
  renderVault(settings);
  const q = await chrome.runtime.sendMessage({ type: 'queue.get' });
  if (q?.running) {
    const done = q.items.filter((i) => ['enviada', 'concluída', 'pulada', 'erro'].includes(i.status)).length;
    $('queue').hidden = false;
    $('queue').textContent = `Parar fila (${done} de ${q.items.length})`;
    $('queue').onclick = async () => { await chrome.runtime.sendMessage({ type: 'queue.stop' }); $('queue').hidden = true; msg('Fila parada.'); };
  }
})();
