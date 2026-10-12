# JobAutoApply

Extensão do Chrome (Manifest V3, sem etapa de build) que preenche candidaturas a vagas com o seu perfil, seus currículos e, quando preciso, IA.

## Instalar

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha esta pasta.
3. A página de configurações abre sozinha. Preencha o perfil e envie os currículos.

## Como funciona

Cada campo do formulário é resolvido nesta ordem:

1. **Respostas salvas**: perguntas que você já respondeu antes.
2. **Perfil**: regras em português e inglês ligam o rótulo do campo a um dado do perfil.
3. **IA** (opcional): só para o que sobrou. Ela recebe perfil, currículo, LinkedIn e a vaga, e é instruída a devolver vazio quando não souber.

Campos ficam contornados em verde (perfil), roxo (IA) ou laranja (falta responder). A extensão nunca marca caixas de aceite de termos nem preenche senhas.

### Modos de IA

- **Automática**: chave de API do Claude ou da OpenAI. As chaves ficam em um cofre cifrado (AES-GCM, chave derivada da senha mestra por PBKDF2). A senha não é salva: você a digita uma vez por sessão do navegador no popup, e o cofre fecha quando o Chrome é encerrado. As chaves só são lidas dentro do service worker e nunca chegam às páginas.
- **Manual**: sem chave. O painel copia as perguntas, abre o claude.ai ou o chatgpt.com em que você já está logado, e você cola o JSON de volta.
- **Desligada**: apenas perfil e respostas salvas.

### LinkedIn

Em `linkedin.com/jobs` o painel aparece sozinho, com **Candidatar-se a esta vaga** e **Fila de vagas da lista**. Por padrão ele para no botão de enviar para você revisar. O envio sem revisão é uma opção na aba Automação.

Em qualquer outro site (Gupy, Greenhouse, Lever, Workday etc.), use o popup ou `Alt+Shift+F`.

## Estrutura

| Caminho | Papel |
|---|---|
| `src/content/matcher.js` | Regras rótulo → perfil e escolha de opções |
| `src/content/filler.js` | Leitura do formulário, preenchimento, anexo de currículo, aprendizado |
| `src/content/linkedin.js` | Fluxo da Candidatura simplificada e leitura do perfil |
| `src/content/panel.js` | Painel flutuante |
| `src/bg/background.js` | Armazenamento, roteamento de mensagens, injeção de scripts |
| `src/bg/llm.js` | Chamadas ao Claude e à OpenAI |
| `src/bg/vault.js` | Cofre cifrado das chaves de API |
| `ui/` | Configurações e popup |
| `test/form.html` | Formulário de teste com `chrome.*` simulado |

## Testar o preenchimento

```bash
python3 -m http.server 8765
```

Abra `http://localhost:8765/test/form.html` e rode `runTest()` no console.

Para o cofre:

```bash
node test/vault.test.mjs
```
