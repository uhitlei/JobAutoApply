// Regras de correspondência entre rótulos de campos e chaves do perfil.
// Não depende de chrome.* para poder ser testado em uma página comum.
(function () {
  const JAA = (window.__JAA = window.__JAA || {});
  if (JAA.matcherLoaded) return;
  JAA.matcherLoaded = true;

  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9+#]+/g, ' ')
      .trim();

  // A ordem importa: regras mais específicas primeiro.
  const RULES = [
    { key: 'coverLetter', re: /(cover letter|carta de apresentacao|carta de motivacao|letter of motivation)/ },
    { key: 'linkedin', re: /linkedin/ },
    { key: 'github', re: /github/ },
    { key: 'portfolio', re: /(portfolio|website|site pessoal|personal site|pagina pessoal|blog)/ },
    { key: 'email', re: /(e ?mail|correio eletronico)/ },
    { key: 'phoneCountryCode', re: /(country code|codigo do pais|ddi)/ },
    { key: 'phone', re: /(phone|telefone|celular|mobile|whatsapp|telemovel)/ },
    { key: 'firstName', re: /(first name|given name|primeiro nome|nome proprio)/, not: /(sobrenome|last)/ },
    { key: 'lastName', re: /(last name|family name|surname|sobrenome|apelido|ultimo nome)/ },
    { key: 'fullName', re: /(full name|nome completo|your name|seu nome|^name$|^nome$|legal name)/ },
    { key: 'cpf', re: /\bcpf\b/ },
    { key: 'birthDate', re: /(date of birth|data de nascimento|birth ?date|nascimento)/ },
    { key: 'zip', re: /(zip|postal code|\bcep\b|codigo postal)/ },
    { key: 'address', re: /(street address|address line|endereco|logradouro|^address$)/ },
    { key: 'city', re: /(\bcity\b|cidade|municipio|location city)/ },
    { key: 'state', re: /(\bstate\b|estado|province|provincia|\buf\b)/, not: /(united states|estados unidos|estado civil)/ },
    { key: 'country', re: /(country|\bpais\b)/ },
    { key: 'location', re: /(location|localizacao|onde voce mora|where are you based|current location)/ },
    { key: 'salary', re: /(salary|salario|pretensao|remuneracao|compensation|expectativa salarial)/ },
    { key: 'noticePeriod', re: /(notice period|aviso previo|when can you start|start date|disponibilidade para inicio|data de inicio|quando pode comecar)/ },
    { key: 'sponsorship', re: /(sponsorship|patrocinio de visto|require .*visa|precisa de visto)/ },
    { key: 'workAuthorization', re: /(authorized to work|legally authorized|autorizacao para trabalhar|autorizado a trabalhar|work permit|right to work)/ },
    { key: 'relocate', re: /(relocat|mudar de cidade|disponibilidade para mudanca|mudanca de cidade)/ },
    { key: 'remote', re: /(work remotely|trabalho remoto|remote work|comfortable working remote)/ },
    { key: 'englishLevel', re: /(english|ingles)/ },
    { key: 'spanishLevel', re: /(spanish|espanhol)/ },
    { key: 'yearsExperience', re: /(years of .*experience|anos de experiencia|how many years|quantos anos|tempo de experiencia)/ },
    { key: 'currentCompany', re: /(current company|current employer|empresa atual|empregador atual)/ },
    { key: 'currentTitle', re: /(current title|current position|job title|cargo atual|current role|posicao atual)/ },
    { key: 'school', re: /(school|university|universidade|faculdade|instituicao de ensino)/ },
    { key: 'degree', re: /(degree|grau|escolaridade|nivel de formacao|formacao academica|education level)/ },
    { key: 'gender', re: /(gender|genero|\bsexo\b)/ },
    { key: 'race', re: /(race|ethnicity|raca|etnia|cor ou raca)/ },
    { key: 'disability', re: /(disability|deficiencia|\bpcd\b)/ },
    { key: 'veteran', re: /veteran/ },
    { key: 'referralSource', re: /(how did you hear|como (voce )?(soube|ficou sabendo|conheceu)|where did you find|onde viu)/ },
    { key: 'summary', re: /(about you|sobre voce|tell us about yourself|fale sobre voce|resumo profissional|professional summary|\bbio\b)/ },
  ];

  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email',
    tel: 'phone', 'tel-national': 'phone', 'street-address': 'address', 'address-line1': 'address',
    'address-level2': 'city', 'address-level1': 'state', 'country-name': 'country', country: 'country',
    'postal-code': 'zip', bday: 'birthDate', url: 'portfolio', 'organization-title': 'currentTitle',
    organization: 'currentCompany',
  };

  function matchKey(field) {
    const ac = (field.autocomplete || '').toLowerCase().split(' ').pop();
    if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
    if (field.type === 'email') return 'email';
    if (field.type === 'tel') return 'phone';
    const texts = [norm(field.label), norm(field.nameAttr)];
    for (const t of texts) {
      if (!t) continue;
      for (const r of RULES) {
        if (r.re.test(t) && !(r.not && r.not.test(t))) return r.key;
      }
    }
    return null;
  }

  // Valor do perfil para uma chave, considerando o rótulo (ex.: anos de experiência por tecnologia).
  function profileValue(profile, key, field) {
    const p = profile || {};
    const full = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ');
    switch (key) {
      case 'fullName': return full;
      case 'firstName': return p.firstName || full.split(' ')[0] || '';
      case 'lastName': return p.lastName || full.split(' ').slice(1).join(' ');
      case 'location': return p.location || [p.city, p.state, p.country].filter(Boolean).join(', ');
      case 'yearsExperience': {
        const label = norm(field.label);
        const bySkill = p.skillsYears || {};
        for (const skill of Object.keys(bySkill)) {
          const s = norm(skill);
          if (s && new RegExp('(^| )' + s.replace(/[+#]/g, '\\$&') + '( |$)').test(label)) return String(bySkill[skill]);
        }
        // Só usa o total quando a pergunta não cita uma tecnologia específica.
        if (/(with|com|em|in|using) /.test(label) && !/(work experience|experiencia profissional|total)/.test(label)) return '';
        return p.yearsExperience != null ? String(p.yearsExperience) : '';
      }
      default: return p[key] != null ? String(p[key]) : '';
    }
  }

  const YES = /^(yes|sim|true|y|s)$/;
  const NO = /^(no|nao|false|n)$/;

  // Escolhe a opção (select/radio) que melhor corresponde ao valor desejado.
  function pickOption(options, value) {
    const v = norm(value);
    if (!v) return null;
    const list = options.map((o) => ({ o, n: norm(o.text) })).filter((x) => x.n && !/^(select|selecione|escolha|choose|please select)/.test(x.n));
    let hit = list.find((x) => x.n === v) || list.find((x) => norm(x.o.value) === v);
    if (hit) return hit.o;
    if (YES.test(v)) hit = list.find((x) => /^(yes|sim)\b/.test(x.n));
    else if (NO.test(v)) hit = list.find((x) => /^(no|nao)\b/.test(x.n));
    if (hit) return hit.o;
    // Número dentro de faixa: "3-5 anos", "5+ years", "menos de 1 ano".
    if (/^\d+([.,]\d+)?$/.test(v)) {
      const num = parseFloat(v.replace(',', '.'));
      for (const x of list) {
        const nums = (x.n.match(/\d+/g) || []).map(Number);
        if (nums.length === 2 && num >= nums[0] && num <= nums[1]) return x.o;
        if (nums.length === 1 && /(\+|mais|more|acima|over)/.test(x.o.text.toLowerCase()) && num >= nums[0]) return x.o;
        if (nums.length === 1 && /(menos|less|under|ate)/.test(x.n) && num <= nums[0]) return x.o;
        if (nums.length === 1 && nums[0] === num) return x.o;
      }
    }
    hit = list.find((x) => x.n.includes(v)) || list.find((x) => x.n.length > 2 && v.includes(x.n));
    return hit ? hit.o : null;
  }

  Object.assign(JAA, { norm, matchKey, profileValue, pickOption, RULES });
})();
