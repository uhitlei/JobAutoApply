<p align="center">
  <img src="icons/icon128.png" width="96" alt="">
</p>

<h1 align="center">JobAutoApply</h1>

<p align="center">
  Extensão do Chrome que preenche candidaturas a vagas com o seu perfil, seus currículos e, quando precisa, IA.<br>
  <em>Chrome extension that fills job applications from your profile, résumés and, when needed, AI. Interface in Portuguese.</em>
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-0e766e">
  <img alt="Sem build" src="https://img.shields.io/badge/build-nenhum-0e766e">
  <img alt="JavaScript puro" src="https://img.shields.io/badge/JavaScript-puro-0e766e">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-0e766e">
</p>

---

## Por que existe

Candidatar-se a vagas é repetir as mesmas respostas dezenas de vezes: nome, telefone, LinkedIn, anos de experiência, pretensão salarial, "por que quer trabalhar aqui". O JobAutoApply guarda tudo isso no seu navegador e preenche os formulários para você. O que ele não sabe responder, uma IA responde com base no seu currículo. O que a IA não sabe, fica em branco para você decidir.

Nada vai para servidor nenhum do projeto. Não há conta, não há backend, não há telemetria.

## Recursos

- **Preenche qualquer formulário de vaga.** Gupy, Greenhouse, Lever, Workday, sites de carreira. Um clique no popup ou o atalho `Alt+Shift+F`.
- **Candidatura simplificada do LinkedIn.** Painel na página de vagas com candidatura à vaga aberta ou fila pela lista de resultados. Por padrão, para no botão de enviar para você revisar.
- **Vários currículos.** Cada um com palavras-chave. A extensão anexa o que mais combina com a descrição da vaga.
- **Aprende com você.** Perguntas que você respondeu à mão viram respostas salvas e são reutilizadas na próxima vez.
- **IA só onde precisa.** Claude ou GPT, por chave de API ou pelo chat em que você já está logado. Instruída a não inventar fatos.
- **Perfil importado do LinkedIn e do currículo em PDF.** A IA extrai os dados e completa os campos vazios do seu perfil.
- **Cofre cifrado para as chaves de API.** Senha mestra, AES-GCM, nada em texto claro no disco.
- **Português e inglês.** As regras de campos reconhecem rótulos nos dois idiomas.

## Instalação

Não há build nem dependências.

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta do projeto.
4. A página de configurações abre sozinha. Preencha o perfil e envie seus currículos.

Funciona também em navegadores baseados em Chromium, como Edge, Brave e Arc.

## Como funciona

Cada campo do formulário é resolvido nesta ordem, e para na primeira que responder:

| Ordem | Fonte | Cor no formulário |
|---|---|---|
| 1 | Respostas salvas de candidaturas anteriores | verde |
| 2 | Seu perfil, por regras que ligam o rótulo do campo a um dado | verde |
| 3 | IA, com perfil, currículo, LinkedIn e descrição da vaga como contexto | roxo |
| 4 | Ninguém. O campo fica destacado para você responder | laranja |

A extensão nunca marca caixas de aceite de termos, nunca preenche senhas e nunca envia um formulário fora do LinkedIn. No LinkedIn, o envio sem revisão é uma opção desligada por padrão.

### Modos de IA

| Modo | O que precisa | Como funciona |
|---|---|---|
| Automática | Chave de API do Claude ou da OpenAI | As perguntas sem resposta vão para a API em segundo plano |
| Manual | Login no claude.ai ou no chatgpt.com | O painel copia as perguntas, abre o chat e você cola o JSON de volta |
| Desligada | Nada | Só perfil e respostas salvas |

O login no claude.ai não dá acesso à API. Por isso o modo manual existe.

## Segurança e privacidade

- **Tudo fica no seu navegador**, em `chrome.storage.local`. Perfil, currículos, respostas e histórico não saem da máquina, exceto para a API de IA que você configurar.
- **As chaves de API ficam em um cofre cifrado.** AES-GCM de 256 bits com chave derivada da senha mestra por PBKDF2 (SHA-256, 600 mil iterações, sal aleatório). A senha nunca é salva. A chave derivada vive em `chrome.storage.session`, só em memória, e some quando o navegador fecha.
- **As páginas nunca recebem as chaves.** Elas só são lidas dentro do service worker. A senha mestra só é digitada no popup e nas configurações, nunca no painel injetado nos sites.
- **O backup exportado não inclui as chaves.**
- **Limite do modelo:** com o cofre aberto, um malware na máquina ainda poderia ler a memória do navegador. Use chaves com limite de gasto no painel do provedor.

## Aviso sobre o LinkedIn

Os termos de uso do LinkedIn proíbem automação, e contas que enviam muitas candidaturas em sequência podem ser restringidas. A extensão tem limite de vagas por fila e pausas aleatórias configuráveis. Use com moderação e por sua conta e risco. Os seletores do LinkedIn mudam com frequência; se algo parar de funcionar, abra uma issue.

## Estrutura

```
manifest.json
src/
  bg/
    background.js   armazenamento, mensagens, injeção de scripts
    llm.js          chamadas ao Claude e à OpenAI
    vault.js        cofre cifrado das chaves de API
  content/
    matcher.js      regras rótulo -> perfil e escolha de opções
    filler.js       leitura do formulário, preenchimento, anexo, aprendizado
    linkedin.js     Candidatura simplificada e leitura do perfil
    panel.js        painel flutuante
ui/
  options.html/js  configurações
  popup.html/js    popup
test/
  form.html        formulário com chrome.* simulado
  vault.test.mjs   teste do cofre
```

## Desenvolvimento e testes

Preenchimento, em um formulário com a API da extensão simulada:

```bash
python3 -m http.server 8765
```

Abra `http://localhost:8765/test/form.html` e rode `runTest()` no console.

Cofre:

```bash
node test/vault.test.mjs
```

Para adicionar o reconhecimento de um campo novo, inclua uma regra em `src/content/matcher.js`. Para dar suporte a um site com fluxo próprio, siga o modelo de `src/content/linkedin.js`.

## Contribuindo

Issues e pull requests são bem-vindos. Os mais úteis agora:

- relatos de campos que não foram reconhecidos, com o rótulo e o site;
- seletores atualizados do LinkedIn;
- fluxos dedicados para outras plataformas de vagas.

## Licença

[MIT](LICENSE).
