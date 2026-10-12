// Executa um item da fila de links na página atual: abre o formulário, preenche, avança etapas
// e devolve o resultado ao processo de fundo. No LinkedIn delega ao fluxo de Candidatura simplificada.
(function () {
  const JAA = (window.__JAA = window.__JAA || {});
  if (JAA.genericLoaded) return;
  JAA.genericLoaded = true;
  const { norm, sleep, visible, send } = JAA;

  const RE = {
    apply: /(apply|candidat|inscrev|aplicar|quero esta vaga|quero a vaga|enviar curriculo|i'?m interested|tenho interesse)/,
    submit: /(submit|enviar|finalizar|concluir|send application|apply now|candidatar|confirmar|enviar candidatura)/,
    next: /(next|continue|avancar|proximo|continuar|seguinte|salvar e continuar|save and continue|prosseguir)/,
    bad: /(cancel|cancelar|voltar|back|login|entrar|sign in|cadastr|register|criar conta|linkedin|google|facebook|apple|indeed|compartilh|share|salvar vaga|save job)/,
  };
  const txt = (b) => norm(`${b.innerText || b.value || ''} ${b.getAttribute('aria-label') || ''}`).slice(0, 80);
  const candidates = (root) => [...root.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a[class*="apply" i], a[href*="apply" i], a[href*="candidat" i]')].filter((b) => visible(b) && !b.disabled);
  const find = (re, root) => candidates(root || document).find((b) => re.test(txt(b)) && !RE.bad.test(txt(b)));
  const fields = () => JAA.collectFields().filter((f) => f.kind !== 'checkbox');

  // Formulário que concentra os campos, para procurar botões nele antes de olhar a página toda.
  function formScope() {
    const count = new Map();
    for (const f of fields()) { const form = f.el.closest('form'); if (form) count.set(form, (count.get(form) || 0) + 1); }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  async function runItem({ item, total, settings }) {
    JAA.linkedin.reset();
    JAA.showQueue && JAA.showQueue({ index: item.index, total, url: item.url });
    const report = (status, note) => send({ type: 'queue.result', status, note: note || '', url: item.url });
    const stopped = () => JAA.linkedin.stopped();
    await sleep(2000);

    if (JAA.linkedin.isJobs()) {
      const r = await JAA.linkedin.applyCurrent(settings);
      const map = { submitted: 'enviada', ready: 'pronta para revisão', skipped: 'pulada', error: 'erro', stopped: 'parada' };
      return report(map[r] || 'erro', r === 'skipped' ? 'sem Candidatura simplificada' : '');
    }

    for (let step = 1; step <= 10; step++) {
      if (stopped()) return report('parada');
      if (fields().length < 2) {
        const apply = find(RE.apply);
        if (apply && !apply.__jaaClicked) {
          apply.__jaaClicked = true;
          JAA.status('Abrindo o formulário de candidatura…');
          // Links costumam abrir em nova aba. Navegamos na própria aba para a fila continuar aqui.
          if (apply.tagName === 'A' && apply.href && !apply.href.startsWith('javascript:') && !apply.href.endsWith('#')) location.href = apply.href;
          else apply.click();
          await sleep(3500);
          continue;
        }
        return report('pronta para revisão', 'formulário não encontrado nesta página');
      }
      JAA.status(`Etapa ${step}: preenchendo…`);
      const sum = await JAA.fillPage();
      if (sum.error) return report('erro', sum.error);
      const required = (sum.pending || []).filter((p) => p.required);
      if (required.length) {
        await JAA.linkedin.waitUser(`${required.length} campo(s) obrigatório(s) sem resposta. Preencha os destacados em laranja e clique em Continuar.`);
        if (stopped()) return report('parada');
      }
      await JAA.learn();
      const scope = formScope();
      const submit = find(RE.submit, scope) || find(RE.submit);
      const next = !submit && (find(RE.next, scope) || find(RE.next));
      if (submit) {
        if (!settings.autoSubmit) { JAA.status('Pronta para enviar. Revise, envie e clique em "Próximo link".', { ready: true }); return report('pronta para revisão', 'revise e envie'); }
        submit.click();
        await sleep(3000);
        return report('enviada');
      }
      if (next) { next.click(); await sleep(2500); continue; }
      JAA.status('Não achei o botão de envio. Finalize à mão e clique em "Próximo link".', { ready: true });
      return report('pronta para revisão', 'botão de envio não encontrado');
    }
    return report('erro', 'formulário com etapas demais');
  }

  JAA.queue = { runItem };
})();
