// Fluxo de "Candidatura simplificada" (Easy Apply) do LinkedIn e leitura do perfil.
// Os seletores do LinkedIn mudam com frequência; por isso priorizamos texto/aria em vez de classes.
(function () {
  const JAA = (window.__JAA = window.__JAA || {});
  if (JAA.linkedinLoaded) return;
  JAA.linkedinLoaded = true;
  const { norm, sleep, visible, send } = JAA;

  const run = { active: false, stop: false, resume: null };
  const rand = (a, b) => a + Math.random() * (b - a);
  const listeners = [];
  const notify = (st) => listeners.forEach((fn) => fn(st));
  JAA.onStatus = (fn) => { listeners.push(fn); };
  const status = (text, extra) => notify(Object.assign({ text }, extra || {}));
  JAA.status = status;

  const RE = {
    easy: /(easy apply|candidatura simplificada|candidate se facilmente|candidatar se facilmente)/,
    submit: /(submit application|enviar candidatura|enviar inscricao)/,
    review: /(review|revisar|revise)/,
    next: /(next|continue|avancar|proximo|continuar|seguinte)/,
    applied: /(applied|candidatou se|candidatura enviada|inscricao enviada)/,
    done: /(done|concluido|concluir|fechar|dismiss|not now|agora nao)/,
  };

  const btnText = (b) => norm(`${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`);

  function findButton(root, re) {
    return [...root.querySelectorAll('button, a[role=button], a.jobs-apply-button')].find((b) => visible(b) && !b.disabled && re.test(btnText(b)));
  }

  // Evita o filtro "Candidatura simplificada" da barra de busca, que tem o mesmo texto.
  function easyApplyButton() {
    const byClass = [...document.querySelectorAll('button.jobs-apply-button, .jobs-apply-button--top-card button, .jobs-s-apply button')].find((b) => visible(b) && !b.disabled && RE.easy.test(btnText(b)));
    if (byClass) return byClass;
    return [...document.querySelectorAll('button, a[role=button]')].find((b) => visible(b) && !b.disabled && RE.easy.test(btnText(b)) && !b.closest('[class*="filter"], [id*="filter"], nav, header'));
  }

  function modal() {
    return [...document.querySelectorAll('.jobs-easy-apply-modal, [role=dialog]')].find((d) => visible(d) && (d.querySelector('form') || findButton(d, RE.submit) || findButton(d, RE.next)));
  }

  function hasErrors(root) {
    return [...root.querySelectorAll('.artdeco-inline-feedback--error, [role=alert], [data-test-form-element-error-messages]')].some((e) => visible(e) && e.innerText.trim());
  }

  // Pausa até o usuário clicar em "Continuar" no painel (ou parar).
  function waitUser(text) {
    status(text, { waiting: true });
    return new Promise((resolve) => { run.resume = () => { run.resume = null; resolve(); }; });
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; if (run.stop) return null; await sleep(300); }
    return null;
  }

  // Candidata-se à vaga aberta. Retorna 'submitted' | 'ready' | 'skipped' | 'stopped' | 'error'.
  async function applyCurrent(settings) {
    const job = JAA.jobContext();
    let dlg = modal();
    if (!dlg) {
      const btn = easyApplyButton();
      if (!btn) { status('Esta vaga não tem Candidatura simplificada.'); return 'skipped'; }
      btn.click();
      dlg = await waitFor(modal, 8000);
      if (!dlg) { status('O formulário do LinkedIn não abriu.'); return 'error'; }
    }
    for (let step = 1; step <= 15 && !run.stop; step++) {
      await sleep(rand(600, 1200));
      dlg = modal();
      if (!dlg) return 'error';
      status(`Etapa ${step}: preenchendo…`);
      const sum = await JAA.fillPage({ root: dlg });
      if (sum.error) { status(sum.error); return 'error'; }
      const required = (sum.pending || []).filter((p) => p.required);
      if (required.length) {
        await waitUser(`Etapa ${step}: ${required.length} campo(s) obrigatório(s) sem resposta. Preencha os destacados em laranja e clique em Continuar.`);
        if (run.stop) return 'stopped';
      }
      dlg = modal();
      if (!dlg) return 'error';
      await JAA.learn(dlg);

      const submit = findButton(dlg, RE.submit);
      if (submit) {
        if (!settings.autoSubmit) {
          status('Pronto para enviar. Revise e clique em "Enviar candidatura" no LinkedIn.', { ready: true });
          await send({ type: 'log.add', entry: { ...job, status: 'pronta para revisão' } });
          return 'ready';
        }
        submit.click();
        await sleep(2500);
        await send({ type: 'log.add', entry: { ...job, status: 'enviada' } });
        const after = [...document.querySelectorAll('[role=dialog]')].find(visible);
        const close = after && (findButton(after, RE.done) || after.querySelector('button[aria-label*="Dismiss" i], button[aria-label*="Fechar" i]'));
        if (close) close.click();
        status('Candidatura enviada.');
        return 'submitted';
      }
      const next = findButton(dlg, RE.review) || findButton(dlg, RE.next);
      if (!next) { await waitUser('Não encontrei o botão de avançar. Avance manualmente e clique em Continuar.'); if (run.stop) return 'stopped'; continue; }
      next.click();
      await sleep(1500);
      const d2 = modal();
      if (d2 && hasErrors(d2)) {
        await waitUser('O LinkedIn apontou erros nesta etapa. Corrija e clique em Continuar.');
        if (run.stop) return 'stopped';
      }
    }
    return run.stop ? 'stopped' : 'error';
  }

  async function start(mode) {
    if (run.active) return;
    run.active = true; run.stop = false;
    try {
      const state = await send({ type: 'state.get' });
      const settings = state.settings;
      if (mode === 'single') { await applyCurrent(settings); return; }

      // Fila: percorre os cartões da lista de resultados.
      const max = settings.maxPerRun || 10;
      let done = 0;
      const seen = new Set();
      while (!run.stop && done < max) {
        const cards = [...document.querySelectorAll('li[data-occludable-job-id], div[data-job-id], li.scaffold-layout__list-item')].filter(visible);
        const card = cards.find((c) => { const id = c.getAttribute('data-occludable-job-id') || c.getAttribute('data-job-id') || c.innerText.slice(0, 80); if (seen.has(id)) return false; seen.add(id); c.__id = id; return true; });
        if (!card) { status(`Fila concluída: ${done} vaga(s) processada(s).`); break; }
        card.scrollIntoView({ block: 'center' });
        if (RE.applied.test(norm(card.innerText))) continue;
        (card.querySelector('a[href*="/jobs/view/"], a') || card).click();
        await sleep(rand(2500, 4000));
        const result = await applyCurrent(settings);
        if (result === 'ready') {
          status('Revise e envie no LinkedIn. A fila continua quando o formulário fechar.', { ready: true });
          await waitFor(() => !modal(), 15 * 60 * 1000);
        }
        if (result === 'submitted' || result === 'ready') done++;
        if (result === 'stopped') break;
        if (result === 'error' && modal()) { await waitUser('Algo travou nesta vaga. Feche o formulário e clique em Continuar para seguir.'); }
        await sleep(rand((settings.delayMin || 4) * 1000, (settings.delayMax || 9) * 1000));
      }
    } finally {
      run.active = false;
      notify({ idle: true });
    }
  }

  function stop() { run.stop = true; if (run.resume) run.resume(); status('Parado.'); }
  function resume() { if (run.resume) run.resume(); }

  // Texto do perfil aberto em linkedin.com/in/... (usado na página de opções).
  function scrapeProfile() {
    const main = document.querySelector('main') || document.body;
    return { url: location.href.split('?')[0], text: main.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 20000) };
  }

  JAA.linkedin = { start, stop, resume, scrapeProfile, applyCurrent, waitUser, stopped: () => run.stop, reset: () => { run.stop = false; }, isJobs: () => location.hostname.endsWith('linkedin.com') && location.pathname.startsWith('/jobs') };
})();
