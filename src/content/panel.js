// Painel flutuante (somente no frame principal). Usa Shadow DOM para não herdar o CSS do site.
(function () {
  const JAA = (window.__JAA = window.__JAA || {});
  if (window.top !== window) return;
  if (JAA.panelLoaded) { JAA.showPanel && JAA.showPanel(); return; }
  JAA.panelLoaded = true;
  const { send } = JAA;
  let host, $, pending = [];

  const CSS_TEXT = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 320px; font: 14px/1.45 system-ui, sans-serif;
      color: #12211f; background: #fbfaf7; border: 1px solid #cfd8d5; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.22); overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #0e766e; color: #fff; font-weight: 600; }
    header button { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; padding: 0 4px; }
    main { padding: 12px; display: grid; gap: 8px; }
    .status { min-height: 40px; padding: 8px 10px; background: #eef3f1; border-radius: 8px; font-size: 13px; }
    .status.warn { background: #fdf0d9; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    button.act { flex: 1 1 auto; padding: 9px 10px; border-radius: 8px; border: 1px solid #0e766e; background: #0e766e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    button.act.sec { background: #fff; color: #0e766e; }
    button.act.danger { background: #fff; border-color: #b42318; color: #b42318; }
    button.act:focus-visible, header button:focus-visible, textarea:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    button[hidden], section[hidden] { display: none; }
    textarea { width: 100%; box-sizing: border-box; min-height: 70px; font: 12px ui-monospace, monospace; border: 1px solid #cfd8d5; border-radius: 8px; padding: 6px; }
    .legend { font-size: 12px; color: #4b5b58; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 4px 0 8px; }
    a { color: #0e766e; }
  `;

  function build() {
    host = document.createElement('div');
    host.id = 'jaa-panel-host';
    const root = host.attachShadow({ mode: 'open' });
    const onJobs = JAA.linkedin && JAA.linkedin.isJobs();
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="box" role="region" aria-label="JobAutoApply">
        <header><span>JobAutoApply</span><button id="close" aria-label="Fechar painel">×</button></header>
        <main>
          <div class="status" id="status" role="status" aria-live="polite">Pronto.</div>
          <div class="row">
            <button class="act" id="fill">Preencher esta página</button>
          </div>
          <div class="row" ${onJobs ? '' : 'hidden'}>
            <button class="act sec" id="easy" ${onJobs ? '' : 'hidden'}>Candidatar-se a esta vaga</button>
            <button class="act sec" id="queue" ${onJobs ? '' : 'hidden'}>Fila de vagas da lista</button>
          </div>
          <div class="row">
            <button class="act" id="resume" hidden>Continuar</button>
            <button class="act danger" id="stop" hidden>Parar</button>
          </div>
          <section id="qsec" hidden>
            <div class="status" id="qinfo"></div>
            <div class="row">
              <button class="act" id="qnext">Próximo link</button>
              <button class="act sec" id="qskip">Pular este</button>
              <button class="act danger" id="qstop">Parar fila</button>
            </div>
          </section>
          <section id="manual" hidden>
            <div class="legend">Sem chave de API: copie as perguntas, cole no Claude ou ChatGPT e traga a resposta em JSON.</div>
            <div class="row"><button class="act sec" id="copy">Copiar perguntas e abrir o Claude</button></div>
            <textarea id="paste" aria-label="Resposta em JSON" placeholder='Cole aqui a resposta em JSON'></textarea>
            <div class="row"><button class="act sec" id="applyjson">Aplicar respostas</button></div>
          </section>
          <div class="row">
            <button class="act sec" id="learn">Salvar minhas respostas</button>
          </div>
          <div class="legend"><span class="dot" style="background:#0e766e;margin-left:0"></span>perfil<span class="dot" style="background:#7c3aed"></span>IA<span class="dot" style="background:#d97706"></span>falta responder · <a href="#" id="opts">Configurações</a></div>
        </main>
      </div>`;
    document.documentElement.appendChild(host);
    $ = (id) => root.getElementById(id);

    $('close').onclick = () => { host.style.display = 'none'; };
    $('opts').onclick = (e) => { e.preventDefault(); send({ type: 'options.open' }); };
    $('fill').onclick = fill;
    $('learn').onclick = async () => { const r = await send({ type: 'tab.learn' }); setStatus(`${(r && r.count) || 0} resposta(s) salva(s) para reutilizar.`); };
    $('easy').onclick = () => startRun('single');
    $('queue').onclick = () => startRun('queue');
    $('resume').onclick = () => { $('resume').hidden = true; JAA.linkedin.resume(); };
    $('stop').onclick = () => JAA.linkedin.stop();
    $('copy').onclick = copyPrompt;
    $('qnext').onclick = async () => { JAA.linkedin.stop(); await send({ type: 'queue.next' }); setStatus('Abrindo o próximo link…'); };
    $('qskip').onclick = async () => { JAA.linkedin.stop(); await send({ type: 'queue.skip' }); setStatus('Pulando…'); };
    $('qstop').onclick = async () => { JAA.linkedin.stop(); await send({ type: 'queue.stop' }); $('qsec').hidden = true; setStatus('Fila parada.'); };
    $('applyjson').onclick = applyJson;

    if (JAA.onStatus) JAA.onStatus((s) => {
      if (s.idle) { $('stop').hidden = true; $('resume').hidden = true; return; }
      setStatus(s.text, s.waiting || s.ready);
      $('resume').hidden = !s.waiting;
    });
  }

  function setStatus(text, warn) { $('status').textContent = text; $('status').classList.toggle('warn', !!warn); }

  function startRun(mode) { $('stop').hidden = false; setStatus('Iniciando…'); JAA.linkedin.start(mode); }

  async function fill() {
    setStatus('Preenchendo…');
    const r = await send({ type: 'tab.fill' });
    if (!r || r.error) return setStatus((r && r.error) || 'Falha ao preencher.', true);
    pending = r.pending || [];
    const parts = [`${r.filled} pelo perfil`, `${r.ai} pela IA`];
    if (r.files.length) parts.push(`currículo anexado: ${r.files.join(', ')}`);
    if (pending.length) parts.push(`${pending.length} sem resposta`);
    setStatus(`Preenchido: ${parts.join(' · ')}.${r.aiError ? ' IA: ' + r.aiError : ''} Revise antes de enviar.`, pending.length > 0 || !!r.aiError);
    $('manual').hidden = !(pending.length && r.aiMode === 'manual');
  }

  async function copyPrompt() {
    const r = await send({ type: 'ai.prompt', questions: pending, job: JAA.jobContext() });
    if (!r || !r.prompt) return setStatus('Não foi possível montar o prompt.', true);
    try { await navigator.clipboard.writeText(r.prompt); } catch (e) { $('paste').value = r.prompt; return setStatus('Copie o texto da caixa abaixo manualmente.', true); }
    setStatus('Perguntas copiadas. Cole no chat, copie o JSON da resposta e volte aqui.');
    window.open(r.chatUrl, '_blank', 'noopener');
  }

  async function applyJson() {
    const m = $('paste').value.match(/\{[\s\S]*\}/);
    let data;
    try { data = JSON.parse(m[0]); } catch (e) { return setStatus('JSON inválido. Cole apenas o bloco de resposta.', true); }
    const answers = data.answers && !Array.isArray(data.answers) ? data.answers : data;
    const r = await send({ type: 'tab.applyAnswers', answers });
    setStatus(`${(r && r.count) || 0} resposta(s) aplicada(s). Revise antes de enviar.`);
  }

  JAA.showPanel = () => { if (!host) build(); host.style.display = ''; };
  JAA.showQueue = (q) => { JAA.showPanel(); $('qsec').hidden = false; $('qinfo').textContent = `Fila: link ${q.index + 1} de ${q.total}`; };
  JAA.showPanel();
})();
