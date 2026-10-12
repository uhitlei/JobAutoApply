// Varre formulários, resolve valores (perfil -> respostas salvas -> IA) e preenche os campos.
(function () {
  const JAA = (window.__JAA = window.__JAA || {});
  if (JAA.fillerLoaded) return;
  JAA.fillerLoaded = true;
  const { norm, matchKey, profileValue, pickOption } = JAA;
  const FRAME = Math.random().toString(36).slice(2, 7);
  const registry = new Map(); // id -> field
  let seq = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : res));
      } catch (e) {
        resolve({ error: String(e) });
      }
    });

  function visible(el) {
    if (!el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    return el.getClientRects().length > 0;
  }

  // LinkedIn e outros repetem o texto para leitores de tela: "Email Email".
  function dedupe(text) {
    const t = String(text || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
    const half = Math.floor(t.length / 2);
    if (t.length > 6 && t.slice(0, half).trim() === t.slice(t.length - half).trim()) return t.slice(0, half).trim();
    return t;
  }

  function textOf(id) {
    const n = document.getElementById(id);
    return n ? n.innerText || n.textContent : '';
  }

  function labelFor(el) {
    const parts = [];
    if (el.labels && el.labels.length) parts.push(el.labels[0].innerText);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) parts.push(lb.split(/\s+/).map(textOf).join(' '));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    let label = dedupe(parts.find((p) => p && p.trim()) || '');
    if (!label) {
      // Texto imediatamente anterior ao campo dentro do contêiner mais próximo.
      let node = el;
      for (let i = 0; i < 4 && node && !label; i++) {
        let prev = node.previousElementSibling;
        while (prev && !label) {
          const t = dedupe(prev.innerText || '');
          if (t && t.length < 200 && !prev.querySelector('input,select,textarea')) label = t;
          prev = prev.previousElementSibling;
        }
        node = node.parentElement;
      }
    }
    if (!label) label = el.getAttribute('placeholder') || el.getAttribute('title') || '';
    return dedupe(label);
  }

  function groupQuestion(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && lg.innerText.trim()) return dedupe(lg.innerText);
    }
    const rg = el.closest('[role=radiogroup],[role=group]');
    if (rg) {
      const lb = rg.getAttribute('aria-labelledby');
      if (lb) return dedupe(lb.split(/\s+/).map(textOf).join(' '));
      if (rg.getAttribute('aria-label')) return dedupe(rg.getAttribute('aria-label'));
    }
    // Sobe até achar um contêiner que tenha todas as opções do grupo e pega o texto que sobra.
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      const same = node.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
      const all = document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
      if (same.length === all.length && same.length > 1) {
        const first = node.firstElementChild;
        const t = first && !first.querySelector('input') ? first.innerText : '';
        if (t && t.trim()) return dedupe(t);
        const prev = node.previousElementSibling;
        if (prev && prev.innerText && prev.innerText.length < 300) return dedupe(prev.innerText);
      }
    }
    return '';
  }

  function optionLabel(input) {
    if (input.labels && input.labels.length) return dedupe(input.labels[0].innerText);
    return dedupe(input.getAttribute('aria-label') || input.value || '');
  }

  function isRequired(el, label) {
    return el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label || '');
  }

  function collectFields(root) {
    root = root || document;
    const fields = [];
    const groups = new Map();
    const els = root.querySelectorAll('input, textarea, select');
    for (const el of els) {
      if (el.disabled || el.readOnly) continue;
      if (el.closest('#jaa-panel-host')) continue;
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search'].includes(type)) continue;
      if (type === 'file') {
        fields.push(reg({ kind: 'file', el, label: labelFor(el) || el.name || '', nameAttr: el.name || el.id }));
        continue;
      }
      if (!visible(el) && !(type === 'radio' || type === 'checkbox')) continue;
      if (type === 'radio' || type === 'checkbox') {
        const key = type + ':' + (el.name || el.id);
        const isGroup = type === 'radio' || (el.name && root.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length > 1);
        if (!isGroup) {
          // Caixa única (termos, consentimento): nunca marcamos sozinhos.
          fields.push(reg({ kind: 'checkbox', el, label: labelFor(el), nameAttr: el.name || el.id, required: isRequired(el) }));
          continue;
        }
        if (!groups.has(key)) {
          const g = reg({ kind: type === 'radio' ? 'radio' : 'checkgroup', el, inputs: [], label: groupQuestion(el), nameAttr: el.name || el.id });
          groups.set(key, g);
          fields.push(g);
        }
        const g = groups.get(key);
        g.inputs.push(el);
        g.required = g.required || isRequired(el);
        continue;
      }
      const label = labelFor(el);
      const f = { el, label, nameAttr: [el.name, el.id].filter(Boolean).join(' '), autocomplete: el.getAttribute('autocomplete') || '', type, required: isRequired(el, label) };
      if (el.tagName === 'SELECT') f.kind = 'select';
      else if (el.tagName === 'TEXTAREA') f.kind = 'textarea';
      else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) f.kind = 'combobox';
      else f.kind = 'text';
      f.maxLength = el.maxLength > 0 ? el.maxLength : undefined;
      fields.push(reg(f));
    }
    for (const f of fields) {
      if (f.kind === 'select') f.options = [...f.el.options].map((o) => ({ text: o.text.trim(), value: o.value, node: o }));
      if (f.inputs) f.options = f.inputs.map((i) => ({ text: optionLabel(i), value: i.value, node: i }));
    }
    return fields;
  }

  function reg(f) {
    if (!f.el.__jaaId) f.el.__jaaId = `${FRAME}-${++seq}`;
    f.id = f.el.__jaaId;
    registry.set(f.id, f);
    return f;
  }

  function isFilled(f) {
    if (f.kind === 'radio' || f.kind === 'checkgroup') return f.inputs.some((i) => i.checked);
    if (f.kind === 'checkbox') return f.el.checked;
    if (f.kind === 'file') return f.el.files && f.el.files.length > 0;
    if (f.kind === 'select') {
      const o = f.el.selectedOptions[0];
      return !!(f.el.value && o && !/^(select|selecione|escolha|choose|please)/i.test(o.text.trim()));
    }
    return !!String(f.el.value || '').trim();
  }

  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function formatFor(f, value) {
    if (f.type === 'number') return String(value).replace(/[^\d.,-]/g, '').replace(',', '.');
    if (f.type === 'date') {
      const m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
    }
    if (f.maxLength) return String(value).slice(0, f.maxLength);
    return String(value);
  }

  async function applyValue(f, value) {
    if (value == null || value === '') return false;
    if (f.kind === 'select') {
      const opt = pickOption(f.options, value);
      if (!opt) return false;
      setNative(f.el, opt.value);
      return true;
    }
    if (f.kind === 'radio') {
      const opt = pickOption(f.options, value);
      if (!opt) return false;
      opt.node.click();
      return true;
    }
    if (f.kind === 'checkgroup') {
      const values = Array.isArray(value) ? value : String(value).split(/[;|]/);
      let any = false;
      for (const v of values) {
        const opt = pickOption(f.options, v);
        if (opt && !opt.node.checked) { opt.node.click(); any = true; }
      }
      return any;
    }
    if (f.kind === 'checkbox' || f.kind === 'file') return false;
    setNative(f.el, formatFor(f, value));
    if (f.kind === 'combobox') {
      // Typeahead (ex.: cidade no LinkedIn): espera a lista e escolhe a primeira sugestão.
      f.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
      for (let i = 0; i < 8; i++) {
        await sleep(250);
        const listId = f.el.getAttribute('aria-controls') || f.el.getAttribute('aria-owns');
        const list = (listId && document.getElementById(listId)) || document.querySelector('[role=listbox]');
        const opt = list && visible(list) && list.querySelector('[role=option]');
        if (opt) { opt.click(); break; }
      }
    }
    f.el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function mark(f, state) {
    const el = f.inputs ? f.inputs[0].closest('fieldset,[role=radiogroup]') || f.inputs[0].parentElement : f.el;
    if (!el || f.kind === 'file') return;
    const colors = { filled: '#0e766e', ai: '#7c3aed', pending: '#d97706' };
    el.style.outline = `2px solid ${colors[state]}`;
    el.style.outlineOffset = '2px';
    el.setAttribute('data-jaa', state);
  }

  async function attachResume(f, job, settings) {
    if (/(cover|carta|transcript|historico|foto|photo|portfolio)/.test(norm(f.label + ' ' + f.nameAttr))) return false;
    if (location.hostname.endsWith('linkedin.com') && !settings.uploadOnLinkedIn) return false;
    const res = await send({ type: 'resume.pick', jobText: `${job.title} ${job.description}`.slice(0, 8000) });
    if (!res || !res.dataB64) return false;
    const bin = atob(res.dataB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], res.fileName, { type: res.mime || 'application/pdf' }));
    f.el.files = dt.files;
    f.el.dispatchEvent(new Event('input', { bubbles: true }));
    f.el.dispatchEvent(new Event('change', { bubbles: true }));
    return res.fileName;
  }

  function jobContext() {
    const pick = (sels) => { for (const s of sels) { const n = document.querySelector(s); if (n && n.innerText.trim()) return n.innerText.trim(); } return ''; };
    const title = pick(['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', 'h1']) || document.title;
    const company = pick(['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '[data-company-name]']);
    const description = pick(['#job-details', '.jobs-description__content', '[class*="job-description"]', '[class*="jobDescription"]', 'main', 'body']).slice(0, 6000);
    return { title, company, description, url: location.href };
  }

  function describe(f) {
    return { id: f.id, label: f.label || f.nameAttr, kind: f.kind, required: !!f.required, maxLength: f.maxLength, options: f.options ? f.options.map((o) => o.text).filter(Boolean) : undefined };
  }

  // Preenche tudo o que conseguir dentro de `root`. Retorna um resumo e as perguntas pendentes.
  async function fillPage(opts) {
    opts = opts || {};
    const state = await send({ type: 'state.get' });
    if (!state || state.error) return { error: (state && state.error) || 'Sem resposta da extensão' };
    const { profile, settings, answers } = state;
    const job = jobContext();
    const fields = collectFields(opts.root);
    const summary = { filled: 0, ai: 0, files: [], pending: [], total: fields.length };
    const unresolved = [];

    for (const f of fields) {
      if (f.kind === 'checkbox') { if (f.required && !f.el.checked) summary.pending.push(describe(f)); continue; }
      if (f.kind === 'file') {
        if (!isFilled(f)) { const name = await attachResume(f, job, settings); if (name) summary.files.push(name); }
        continue;
      }
      if (isFilled(f) && !opts.overwrite) continue;
      if (!f.label && !f.nameAttr) continue;
      const saved = answers[norm(f.label)];
      const key = matchKey(f);
      let value = saved != null && saved !== '' ? saved : key ? profileValue(profile, key, f) : '';
      if (key === 'coverLetter' && !value) value = '';
      if (value && (await applyValue(f, value))) { summary.filled++; mark(f, 'filled'); continue; }
      unresolved.push(f);
    }

    let aiAnswers = {};
    if (unresolved.length && settings.aiMode === 'api' && !opts.noAi) {
      const res = await send({ type: 'ai.answer', questions: unresolved.map(describe), job });
      if (res && res.answers) aiAnswers = res.answers;
      if (res && res.error) summary.aiError = res.error;
    }
    for (const f of unresolved) {
      const v = aiAnswers[f.id];
      if (v != null && v !== '' && (await applyValue(f, v))) { summary.ai++; mark(f, 'ai'); continue; }
      if (f.required || f.kind !== 'text' || f.label) { summary.pending.push(describe(f)); mark(f, 'pending'); }
    }
    summary.job = job;
    return summary;
  }

  // Aplica respostas vindas de fora (modo manual: coladas do Claude/ChatGPT).
  async function applyAnswers(map) {
    let n = 0;
    for (const [id, v] of Object.entries(map || {})) {
      const f = registry.get(id);
      if (f && f.el.isConnected && v != null && v !== '' && (await applyValue(f, v))) { n++; mark(f, 'ai'); }
    }
    return n;
  }

  // Guarda o que o usuário digitou em perguntas que o perfil não cobre, para reutilizar depois.
  async function learn(root) {
    const learned = {};
    for (const f of collectFields(root)) {
      if (['file', 'checkbox', 'checkgroup'].includes(f.kind) || !f.label || !isFilled(f)) continue;
      if (matchKey(f)) continue;
      let v;
      if (f.kind === 'radio') v = optionLabel(f.inputs.find((i) => i.checked));
      else if (f.kind === 'select') v = f.el.selectedOptions[0].text.trim();
      else v = f.el.value.trim();
      if (v && v.length <= 1500) learned[norm(f.label)] = v;
    }
    if (Object.keys(learned).length) await send({ type: 'answers.learn', learned });
    return Object.keys(learned).length;
  }

  Object.assign(JAA, { fillPage, applyAnswers, learn, collectFields, jobContext, send, sleep, visible, isFilled });
})();
