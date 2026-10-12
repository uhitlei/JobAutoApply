const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+#]+/g, ' ').trim();
let toastTimer;
function toast(text) { $('toast').textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($('toast').textContent = ''), 5000); }
function el(tag, props, ...kids) { const n = Object.assign(document.createElement(tag), props || {}); n.append(...kids); return n; }

const PROFILE_FIELDS = [
  ['Identificação', [
    ['fullName', 'Nome completo'], ['firstName', 'Primeiro nome'], ['lastName', 'Sobrenome'], ['email', 'E-mail', 'email'],
    ['phone', 'Telefone', 'tel'], ['phoneCountryCode', 'Código do país', 'text', 'Ex.: Brasil (+55)'], ['cpf', 'CPF'], ['birthDate', 'Data de nascimento', 'text', 'dd/mm/aaaa'],
  ]],
  ['Endereço', [['address', 'Endereço'], ['city', 'Cidade'], ['state', 'Estado'], ['country', 'País'], ['zip', 'CEP']]],
  ['Links', [['linkedin', 'LinkedIn', 'url'], ['github', 'GitHub', 'url'], ['portfolio', 'Portfólio ou site', 'url']]],
  ['Carreira', [
    ['currentTitle', 'Cargo atual'], ['currentCompany', 'Empresa atual'], ['yearsExperience', 'Anos de experiência (total)', 'number'],
    ['salary', 'Pretensão salarial'], ['noticePeriod', 'Disponibilidade para início', 'text', 'Ex.: Imediata, 30 dias'],
    ['school', 'Instituição de ensino'], ['degree', 'Formação'], ['englishLevel', 'Nível de inglês'], ['spanishLevel', 'Nível de espanhol'],
  ]],
  ['Perguntas frequentes', [
    ['workAuthorization', 'Autorizado a trabalhar no país?', 'text', 'Sim ou Não'], ['sponsorship', 'Precisa de patrocínio de visto?', 'text', 'Sim ou Não'],
    ['relocate', 'Aceita mudar de cidade?', 'text', 'Sim ou Não'], ['remote', 'Aceita trabalho remoto?', 'text', 'Sim ou Não'],
    ['referralSource', 'Como soube da vaga?', 'text', 'Ex.: LinkedIn'],
  ]],
  ['Diversidade (opcional)', [['gender', 'Gênero'], ['race', 'Cor ou raça'], ['disability', 'Pessoa com deficiência?'], ['veteran', 'Veterano militar?']]],
];

function buildProfileForm(profile) {
  const host = $('profile-form');
  host.textContent = '';
  for (const [title, fields] of PROFILE_FIELDS) {
    const grid = el('div', { className: 'grid' });
    for (const [key, label, type, hint] of fields) {
      const input = el('input', { type: type || 'text', id: 'p-' + key, value: profile[key] ?? '' });
      grid.append(el('label', {}, label, hint ? el('small', {}, hint) : '', input));
    }
    host.append(el('div', { className: 'card' }, el('h3', { style: 'margin-top:0' }, title), grid));
  }
  const skills = el('textarea', { id: 'p-skillsYears', value: Object.entries(profile.skillsYears || {}).map(([k, v]) => `${k}: ${v}`).join('\n') });
  const summary = el('textarea', { id: 'p-summary', value: profile.summary || '' });
  const cover = el('textarea', { id: 'p-coverLetter', value: profile.coverLetter || '' });
  host.append(el('div', { className: 'card' },
    el('label', {}, 'Anos de experiência por tecnologia', el('small', {}, 'Uma por linha, no formato "React: 5". Responde perguntas como "Quantos anos de experiência com React?".'), skills),
    el('label', { style: 'margin-top:1rem' }, 'Resumo profissional', summary),
    el('label', { style: 'margin-top:1rem' }, 'Carta de apresentação padrão', el('small', {}, 'Usada quando o formulário pede carta. Em branco, a IA escreve uma se estiver ligada.'), cover)));
}

function readProfile() {
  const p = {};
  for (const [, fields] of PROFILE_FIELDS) for (const [key] of fields) { const v = $('p-' + key).value.trim(); if (v) p[key] = v; }
  for (const k of ['summary', 'coverLetter']) { const v = $('p-' + k).value.trim(); if (v) p[k] = v; }
  p.skillsYears = {};
  for (const line of $('p-skillsYears').value.split('\n')) { const m = line.match(/^(.+?)\s*[:=]\s*([\d.,]+)/); if (m) p.skillsYears[m[1].trim()] = m[2].replace(',', '.'); }
  return p;
}

// Só preenche campos vazios: o que a pessoa digitou tem prioridade sobre o que a IA extraiu.
async function mergeProfile(extracted) {
  const current = readProfile();
  let n = 0;
  for (const [k, v] of Object.entries(extracted || {})) {
    if (v == null || v === '') continue;
    if (k === 'skillsYears') { current.skillsYears = { ...v, ...current.skillsYears }; continue; }
    if (!current[k]) { current[k] = v; n++; }
  }
  await chrome.storage.local.set({ profile: current });
  buildProfileForm(current);
  return n;
}

// ---- Currículos ----
function toB64(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });
}
async function getResumes() { return (await chrome.storage.local.get('resumes')).resumes || []; }
async function setResumes(list) { await chrome.storage.local.set({ resumes: list }); renderResumes(); }

async function renderResumes() {
  const list = await getResumes();
  const host = $('resume-list');
  host.textContent = '';
  if (!list.length) host.append(el('p', { className: 'help' }, 'Nenhum currículo enviado ainda.'));
  for (const r of list) {
    const name = el('input', { type: 'text', value: r.name });
    const kw = el('input', { type: 'text', value: r.keywords || '', placeholder: 'react, frontend, typescript' });
    const text = el('textarea', { value: r.text || '' });
    const def = el('input', { type: 'radio', name: 'default-resume', checked: !!r.isDefault });
    const save = el('button', { className: 'btn sec' }, 'Salvar');
    const extract = el('button', { className: 'btn sec' }, 'Extrair texto e perfil com IA');
    const del = el('button', { className: 'btn danger' }, 'Remover');
    const update = async (patch) => { const all = await getResumes(); const i = all.findIndex((x) => x.id === r.id); Object.assign(all[i], patch); if (patch.isDefault) all.forEach((x, j) => (x.isDefault = j === i)); await chrome.storage.local.set({ resumes: all }); };
    save.onclick = async () => { await update({ name: name.value.trim() || r.fileName, keywords: kw.value, text: text.value, isDefault: def.checked || undefined }); toast('Currículo salvo.'); renderResumes(); };
    del.onclick = async () => { if (confirm(`Remover "${r.name}"?`)) setResumes((await getResumes()).filter((x) => x.id !== r.id)); };
    extract.onclick = async () => {
      extract.disabled = true; extract.textContent = 'Lendo o currículo…';
      const isPdf = r.mime === 'application/pdf';
      if (!isPdf && !text.value.trim()) { toast('Para DOCX, cole o texto do currículo na caixa antes de extrair.'); extract.disabled = false; extract.textContent = 'Extrair texto e perfil com IA'; return; }
      const res = await send({ type: 'ai.extract', pdfB64: isPdf ? r.dataB64 : undefined, fileName: r.fileName, sourceText: isPdf ? undefined : text.value });
      extract.disabled = false; extract.textContent = 'Extrair texto e perfil com IA';
      if (!res || res.error) return toast(res?.error || 'Falha na extração.');
      if (res.text) { text.value = res.text; await update({ text: res.text }); }
      const n = await mergeProfile(res.profile);
      toast(`Texto extraído. ${n} campo(s) vazio(s) do perfil foram preenchidos. Confira na aba Perfil.`);
    };
    host.append(el('div', { className: 'resume' },
      el('header', {}, el('strong', {}, `${r.fileName} · ${Math.round(r.size / 1024)} KB`), el('label', { className: 'inline' }, def, 'Currículo padrão')),
      el('div', { className: 'grid' }, el('label', {}, 'Nome', name), el('label', {}, 'Palavras-chave da vaga', el('small', {}, 'Separadas por vírgula'), kw)),
      el('label', { style: 'margin-top:.8rem' }, 'Texto do currículo', el('small', {}, 'Contexto para a IA. Cole aqui ou extraia do PDF.'), text),
      el('div', { className: 'row' }, save, extract, del)));
  }
}

$('resume-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('Arquivo acima de 8 MB.');
  const list = await getResumes();
  list.push({ id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, mime: file.type || 'application/pdf', size: file.size, dataB64: await toB64(file), keywords: '', text: '', isDefault: !list.length });
  e.target.value = '';
  await setResumes(list);
  toast('Currículo adicionado.');
};

// ---- LinkedIn ----
$('li-import').onclick = async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' });
  if (!tabs.length) return toast('Abra o seu perfil (linkedin.com/in/...) em outra aba e tente de novo.');
  const res = await send({ type: 'linkedin.scrape', tabId: tabs[0].id });
  if (!res || res.error || !res.text) return toast(res?.error || 'Não consegui ler o perfil.');
  $('li-text').value = res.text;
  if (!$('p-linkedin').value) { $('p-linkedin').value = res.url; await chrome.storage.local.set({ profile: readProfile() }); }
  toast('Perfil do LinkedIn importado.');
};
$('li-save').onclick = async () => { await chrome.storage.local.set({ linkedinText: $('li-text').value }); toast('Texto salvo.'); };
$('li-to-profile').onclick = async (e) => {
  if (!$('li-text').value.trim()) return toast('Importe ou cole o texto do perfil primeiro.');
  e.target.disabled = true;
  const res = await send({ type: 'ai.extract', sourceText: $('li-text').value });
  e.target.disabled = false;
  if (!res || res.error) return toast(res?.error || 'Falha na extração.');
  toast(`${await mergeProfile(res.profile)} campo(s) vazio(s) do perfil foram preenchidos.`);
};

// ---- Configurações ----
const SETTING_IDS = ['aiMode', 'provider', 'manualChat', 'anthropicModel', 'openaiModel', 'autoSubmit', 'uploadOnLinkedIn', 'maxPerRun', 'delayMin', 'delayMax'];
const DEFAULTS = { aiMode: 'off', provider: 'anthropic', manualChat: 'https://claude.ai/new', anthropicModel: 'claude-opus-5', openaiModel: 'gpt-4o-mini', maxPerRun: 10, delayMin: 4, delayMax: 9 };
function loadSettings(s) {
  for (const id of SETTING_IDS) { const n = $(id); const v = s[id] ?? DEFAULTS[id] ?? ''; if (n.type === 'checkbox') n.checked = !!v; else n.value = v; }
}
async function saveSettings() {
  const s = {};
  for (const id of SETTING_IDS) { const n = $(id); s[id] = n.type === 'checkbox' ? n.checked : n.type === 'number' ? Number(n.value) : n.value.trim(); }
  if (s.delayMax < s.delayMin) s.delayMax = s.delayMin;
  if (s.autoSubmit && !confirm('Com o envio automático, candidaturas serão enviadas sem você revisar as respostas. Confirmar?')) { s.autoSubmit = false; $('autoSubmit').checked = false; }
  await chrome.storage.local.set({ settings: s });
  toast('Configurações salvas.');
}
$('save-ai').onclick = saveSettings;
$('save-auto').onclick = saveSettings;
$('save-profile').onclick = async () => { await chrome.storage.local.set({ profile: readProfile() }); toast('Perfil salvo.'); };

// ---- Cofre das chaves de API ----
const show = (id, on) => ($(id).hidden = !on);
async function renderVault() {
  const st = await send({ type: 'vault.status' });
  const { legacyKeys } = await chrome.storage.local.get('legacyKeys');
  show('vault-create', !st.configured); show('vault-locked', st.configured && !st.unlocked); show('vault-open', st.unlocked);
  if (!st.configured) {
    $('vault-status').textContent = legacyKeys ? 'Encontrei chaves salvas em texto claro por uma versão anterior. Crie a senha mestra para cifrá-las.' : 'Nenhuma chave cadastrada. Crie o cofre para usar a IA automática.';
    if (legacyKeys) { $('v-new-anthropic').value = legacyKeys.anthropicKey || ''; $('v-new-openai').value = legacyKeys.openaiKey || ''; }
  } else if (!st.unlocked) {
    $('vault-status').textContent = 'Cofre bloqueado. Digite a senha mestra para usar ou editar as chaves.';
  } else {
    $('vault-status').textContent = 'Cofre aberto nesta sessão do navegador.';
    const keys = await send({ type: 'vault.getKeys' });
    if (keys && !keys.error) { $('v-anthropic').value = keys.anthropicKey || ''; $('v-openai').value = keys.openaiKey || ''; }
  }
}
async function vaultCall(msg, okText) {
  const r = await send(msg);
  if (!r || r.error) { toast(r?.error || 'Falha no cofre.'); return false; }
  if (okText) toast(okText);
  await renderVault();
  return true;
}
$('v-create').onclick = async () => {
  if ($('v-pass1').value !== $('v-pass2').value) return toast('As senhas não coincidem.');
  if (await vaultCall({ type: 'vault.create', password: $('v-pass1').value, keys: { anthropicKey: $('v-new-anthropic').value, openaiKey: $('v-new-openai').value } }, 'Cofre criado e chaves cifradas.')) {
    for (const id of ['v-pass1', 'v-pass2', 'v-new-anthropic', 'v-new-openai']) $(id).value = '';
  }
};
$('v-unlock').onclick = async () => { if (await vaultCall({ type: 'vault.unlock', password: $('v-unlock-pass').value }, 'Cofre desbloqueado.')) $('v-unlock-pass').value = ''; };
$('v-unlock-pass').onkeydown = (e) => { if (e.key === 'Enter') $('v-unlock').click(); };
$('v-lock').onclick = () => vaultCall({ type: 'vault.lock' }, 'Cofre bloqueado.');
$('v-save').onclick = () => vaultCall({ type: 'vault.setKeys', keys: { anthropicKey: $('v-anthropic').value, openaiKey: $('v-openai').value } }, 'Chaves salvas e cifradas.');
$('v-show').onchange = (e) => { const t = e.target.checked ? 'text' : 'password'; $('v-anthropic').type = t; $('v-openai').type = t; };
$('v-change').onclick = async () => {
  if ($('v-new1').value !== $('v-new2').value) return toast('As novas senhas não coincidem.');
  if (await vaultCall({ type: 'vault.changePassword', oldPassword: $('v-old').value, newPassword: $('v-new1').value }, 'Senha mestra trocada.')) for (const id of ['v-old', 'v-new1', 'v-new2']) $(id).value = '';
};
const removeVault = async () => { if (confirm('Apagar o cofre? As chaves cifradas serão perdidas e você precisará cadastrá-las de novo.')) await vaultCall({ type: 'vault.remove' }, 'Cofre apagado.'); };
$('v-remove').onclick = removeVault;
$('v-remove-locked').onclick = removeVault;

// ---- Respostas salvas e histórico ----
async function renderAnswers() {
  const { answers = {} } = await chrome.storage.local.get('answers');
  const body = $('ans-body');
  body.textContent = '';
  for (const [q, a] of Object.entries(answers)) {
    const del = el('button', { className: 'btn danger' }, 'Remover');
    del.setAttribute('aria-label', `Remover resposta de: ${q}`);
    del.onclick = async () => { delete answers[q]; await chrome.storage.local.set({ answers }); renderAnswers(); };
    body.append(el('tr', {}, el('td', {}, q), el('td', {}, a), el('td', {}, del)));
  }
  if (!body.children.length) body.append(el('tr', {}, el('td', { colSpan: 3, className: 'help' }, 'Nada salvo ainda.')));
}
$('ans-add').onclick = async () => {
  const q = norm($('ans-q').value), a = $('ans-a').value.trim();
  if (!q || !a) return toast('Informe a pergunta e a resposta.');
  const { answers = {} } = await chrome.storage.local.get('answers');
  answers[q] = a;
  await chrome.storage.local.set({ answers });
  $('ans-q').value = $('ans-a').value = '';
  renderAnswers();
};
async function renderLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  const body = $('log-body');
  body.textContent = '';
  for (const e of log) {
    const a = el('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.title || 'Vaga');
    body.append(el('tr', {}, el('td', {}, new Date(e.date).toLocaleString('pt-BR')), el('td', {}, a), el('td', {}, e.company || ''), el('td', {}, e.status)));
  }
  if (!log.length) body.append(el('tr', {}, el('td', { colSpan: 4, className: 'help' }, 'Nenhuma candidatura registrada.')));
}
$('log-clear').onclick = async () => { if (confirm('Limpar todo o histórico?')) { await chrome.storage.local.set({ log: [] }); renderLog(); } };

// ---- Backup ----
$('export').onclick = async () => {
  const data = await chrome.storage.local.get(null);
  delete data.vault; delete data.legacyKeys;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  el('a', { href: url, download: 'jobautoapply-backup.json' }).click();
  URL.revokeObjectURL(url);
};
$('import').onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    delete data.vault; delete data.legacyKeys;
    if (data.settings) { delete data.settings.anthropicKey; delete data.settings.openaiKey; }
    await chrome.storage.local.set(data);
    location.reload();
  } catch (err) { toast('Arquivo de backup inválido.'); }
};

// ---- Abas ----
const tabs = [...document.querySelectorAll('nav [role=tab]')];
function selectTab(name) {
  for (const t of tabs) { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('tab-' + t.dataset.tab).hidden = !on; }
  if (name === 'respostas') renderAnswers();
  if (name === 'historico') renderLog();
  if (name === 'curriculos') renderResumes();
  if (name === 'ia') renderVault();
}
tabs.forEach((t, i) => {
  t.onclick = () => selectTab(t.dataset.tab);
  t.onkeydown = (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); selectTab(n.dataset.tab); } };
});

(async function init() {
  const s = await chrome.storage.local.get(['profile', 'settings', 'linkedinText']);
  buildProfileForm(s.profile || {});
  loadSettings(s.settings || {});
  $('li-text').value = s.linkedinText || '';
  selectTab(location.hash.slice(1) || 'perfil');
})();
