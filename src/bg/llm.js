// Chamadas de IA (Claude e GPT). Roda apenas no service worker: as chaves nunca vão para as páginas.
// HTTP direto porque a extensão não tem etapa de build para empacotar os SDKs oficiais.

export const DEFAULT_MODELS = { anthropic: 'claude-opus-5', openai: 'gpt-4o-mini' };

const SYSTEM = `Você ajuda uma pessoa a preencher formulários de candidatura a vagas.
Regras:
- Use somente fatos presentes no perfil, no currículo e nas respostas salvas. Nunca invente experiência, formação, certificações, números ou datas.
- Se não houver informação suficiente para responder com segurança, devolva null para aquela pergunta.
- Responda no idioma da pergunta. Textos livres devem ser curtos, naturais e em primeira pessoa.
- Para perguntas com opções, devolva exatamente o texto de uma das opções.
- Para campos numéricos, devolva só o número.
- Devolva apenas JSON válido, sem comentários nem cercas de código.`;

export function buildAnswerPrompt({ profile, resumeText, linkedinText, answers, questions, job }) {
  return `## Perfil
${JSON.stringify(profile, null, 1)}

## Currículo (texto)
${resumeText || '(não informado)'}

## Perfil do LinkedIn (texto)
${(linkedinText || '(não importado)').slice(0, 8000)}

## Respostas salvas anteriormente
${JSON.stringify(answers || {}, null, 1)}

## Vaga
Título: ${job?.title || ''}
Empresa: ${job?.company || ''}
Descrição: ${(job?.description || '').slice(0, 5000)}

## Perguntas do formulário
${JSON.stringify(questions, null, 1)}

Responda com JSON no formato {"answers": {"<id da pergunta>": "<resposta>" ou null}}. Respeite maxLength quando existir.`;
}

export function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('A IA não devolveu JSON.');
  return JSON.parse(m[0]);
}

async function callAnthropic(settings, { system, text, pdfB64 }) {
  const content = [];
  if (pdfB64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } });
  content.push({ type: 'text', text });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      // Necessário porque a chamada sai de um contexto de navegador (origem chrome-extension://).
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.anthropicModel || DEFAULT_MODELS.anthropic,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // ajustes simples de texto: esforço baixo reduz custo e latência
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${data?.error?.message || res.statusText}`);
  if (data.stop_reason === 'refusal') throw new Error('O Claude recusou este pedido.');
  if (data.stop_reason === 'max_tokens') throw new Error('Resposta do Claude foi cortada por limite de tokens.');
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function callOpenAI(settings, { system, text, pdfB64, fileName }) {
  const content = [];
  if (pdfB64) content.push({ type: 'file', file: { filename: fileName || 'curriculo.pdf', file_data: `data:application/pdf;base64,${pdfB64}` } });
  content.push({ type: 'text', text });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.openaiKey}` },
    body: JSON.stringify({
      model: settings.openaiModel || DEFAULT_MODELS.openai,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || res.statusText}`);
  return data.choices?.[0]?.message?.content || '';
}

export async function callLLM(settings, req) {
  const provider = settings.provider || 'anthropic';
  if (provider === 'anthropic') {
    if (!settings.anthropicKey) throw new Error('Informe a chave da API do Claude nas configurações.');
    return callAnthropic(settings, req);
  }
  if (!settings.openaiKey) throw new Error('Informe a chave da API da OpenAI nas configurações.');
  return callOpenAI(settings, req);
}

export async function answerQuestions(settings, ctx) {
  const text = await callLLM(settings, { system: SYSTEM, text: buildAnswerPrompt(ctx) });
  const data = parseJson(text);
  return data.answers && typeof data.answers === 'object' ? data.answers : data;
}

export function manualPrompt(ctx) {
  return `${SYSTEM}\n\n${buildAnswerPrompt(ctx)}`;
}

const PROFILE_KEYS = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country', 'linkedin', 'github', 'portfolio', 'currentTitle', 'currentCompany', 'yearsExperience', 'school', 'degree', 'englishLevel', 'spanishLevel', 'summary', 'skillsYears'];

// Extrai o texto e os dados estruturados de um currículo (PDF ou texto) ou do perfil do LinkedIn.
export async function extractProfile(settings, { pdfB64, fileName, sourceText }) {
  const text = `Leia o ${pdfB64 ? 'currículo em PDF anexado' : 'texto abaixo'} e devolva JSON no formato:
{"text": "<texto completo do documento, em texto puro>", "profile": {${PROFILE_KEYS.map((k) => `"${k}": ...`).join(', ')}}}
- "skillsYears" é um objeto {"tecnologia": anos} apenas quando os anos puderem ser calculados pelas datas das experiências.
- "yearsExperience" é o total de anos de experiência profissional, como número.
- Use null para o que não estiver no documento. Não invente nada.
${sourceText ? `\n## Texto\n${sourceText}` : ''}`;
  const out = await callLLM(settings, { system: 'Você extrai dados de currículos com precisão. Devolva apenas JSON válido.', text, pdfB64, fileName });
  return parseJson(out);
}
