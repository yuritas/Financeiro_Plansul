# Fluxo de Caixa Plansul — guia de instalação

Este painel roda inteiramente fora da Claude. Ele tem três partes:

1. **A tela** (`index.html`, `diretoria.html`, `app.js`, `styles.css`) — hospedada de graça no GitHub Pages.
2. **O servidor** (`apps-script/Code.gs`) — roda de graça no Google Apps Script, vinculado a uma Planilha Google.
3. **O armazenamento** — a própria Planilha Google (usuários, contas, histórico) e uma pasta no seu Google Drive (lançamentos de cada relatório e uma cópia do arquivo original).

Leva uns 15-20 minutos para configurar tudo pela primeira vez. Depois disso, o dia a dia é só abrir o link e usar.

---

## Parte 1 — Criar a Planilha e o servidor (Google Apps Script)

1. Acesse [sheets.google.com](https://sheets.google.com) com a conta Google que vai "dona" do sistema (pode ser sua conta pessoal por enquanto, como combinamos).
2. Crie uma planilha em branco e dê um nome, por exemplo **"Plansul — Fluxo de Caixa — Dados"**.
3. No menu, vá em **Extensões > Apps Script**. Uma aba nova vai abrir com um editor de código.
4. Apague todo o conteúdo do arquivo `Código.gs` que aparece lá, e cole no lugar todo o conteúdo do arquivo `apps-script/Code.gs` desta entrega.
5. Clique no ícone de disquete (Salvar projeto). Dê um nome ao projeto, por exemplo "Plansul Fluxo de Caixa - Backend".
6. Volte para a aba da Planilha (não a do editor de script) e **recarregue a página** (F5). Depois de alguns segundos, um novo menu **"Plansul"** vai aparecer na barra de menus, ao lado de "Ajuda".
7. Clique em **Plansul > Configurar planilha (1ª vez)**.
   - Na primeira vez, o Google vai pedir autorização ("Este app não foi verificado"). Isso é normal para scripts pessoais — clique em **Avançado** e depois em **Acessar Plansul Fluxo de Caixa - Backend (não seguro)**. É seguro: é o seu próprio script, feito para você.
   - Confirme as permissões pedidas (acesso à Planilha e ao Drive).
   - Uma mensagem vai confirmar que a planilha foi configurada (isso cria as abas Usuarios, Contas, Fontes e Historico, e a pasta no Drive).

### Criar os três usuários

8. Ainda no menu **Plansul**, clique em **Criar novo usuário**. Repita este passo três vezes, uma para cada pessoa:

   | Usuário (login) | Papel | Nome de exibição | Senha inicial |
   |---|---|---|---|
   | `financeiro` | `financeiro` | Equipe Financeira | `Plansul.Financeiro@100` |
   | `andre` | `diretoria` | André | `Plansul_Andre@100` |
   | `peter` | `diretoria` | Peter | `Plansul_Peter@100` |

   (Pode usar essas senhas de exemplo ou já trocar por outras — o importante é digitar exatamente `financeiro` ou `diretoria` no campo de papel, sem acento e em minúsculas.)

   Depois, para trocar uma senha a qualquer momento, use **Plansul > Definir senha de usuário** — nunca escreva a senha diretamente nas células da planilha.

### Publicar como Web App

9. No editor de script (Extensões > Apps Script), clique em **Implantar > Nova implantação**.
10. Clique no ícone de engrenagem ao lado de "Selecionar tipo" e escolha **Aplicativo da Web**.
11. Preencha:
    - **Executar como:** Eu (seu e-mail)
    - **Quem pode acessar:** Qualquer pessoa
12. Clique em **Implantar**, autorize novamente se pedir, e copie a **URL do aplicativo da Web** que aparece — termina em `/exec`. Guarde essa URL, você vai usar no próximo passo.

> Sempre que você editar o `Code.gs` no futuro, é preciso ir em **Implantar > Gerenciar implantações**, editar (ícone de lápis) a implantação existente e escolher "Nova versão" — só salvar o arquivo não atualiza o Web App.

---

## Parte 2 — Configurar e publicar a tela (GitHub Pages)

13. Abra o arquivo `app.js` desta entrega num editor de texto simples (Bloco de Notas, VS Code, etc.).
14. Logo nas primeiras linhas, encontre:
    ```js
    const APPS_SCRIPT_URL = 'COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT';
    ```
    Substitua o texto entre aspas pela URL que você copiou no passo 12 (mantendo o `/exec` no final). Salve o arquivo.
15. Crie uma conta gratuita em [github.com](https://github.com), se ainda não tiver.
16. Crie um repositório novo (botão verde **New**), por exemplo chamado `plansul-fluxo-caixa`.
    - **Importante:** no plano gratuito do GitHub, o Pages (a página publicada) só funciona em repositórios **públicos**. Isso não é problema aqui — o código desses arquivos não tem nenhuma senha nem dado financeiro (tudo isso mora só na sua Planilha e no Drive, que continuam privados). O que fica público é só a "casca" do painel; sem login válido, ninguém vê nenhum número.
17. Envie os 4 arquivos para esse repositório: `index.html`, `diretoria.html`, `app.js` (já editado no passo 14) e `styles.css`. A forma mais simples: na página do repositório, clique em **Add file > Upload files**, arraste os quatro arquivos e clique em **Commit changes**.
18. Vá em **Settings > Pages** (menu lateral do repositório). Em "Build and deployment", escolha **Deploy from a branch**, selecione o branch **main** e a pasta **/ (root)**, e clique em **Save**.
19. Espere 1-2 minutos e recarregue a página de Settings > Pages — vai aparecer um link parecido com `https://SEUUSUARIO.github.io/plansul-fluxo-caixa/`.

Esses são os dois links que você vai usar:

- **Financeiro** (upload + edição): `https://SEUUSUARIO.github.io/plansul-fluxo-caixa/index.html`
- **Diretoria** (somente leitura): `https://SEUUSUARIO.github.io/plansul-fluxo-caixa/diretoria.html`

---

## Parte 3 — Testar

20. Abra o link do financeiro, entre com usuário `financeiro` e a senha que você cadastrou. Você deve ver o painel com o aviso de "dados de exemplo".
21. Clique em **Carregar relatório**, escolha um dos bancos e envie uma planilha real. Confira se os números do painel mudam e se o envio aparece em **Histórico de uploads**.
22. Abra o link da diretoria numa aba anônima (ou peça para o André/Peter abrirem), entre com o usuário `andre` ou `peter`, e confirme que aparece "Somente leitura" e que não existe o botão de carregar relatório.

Se algo não funcionar, o erro mais comum é a URL do Apps Script errada ou desatualizada (volte ao passo 12 e 14) — o painel mostra uma mensagem explicando quando isso acontece.

**Se aparecer um erro de "CORS" no console do navegador** (aperte F12 para ver): esse é o único ponto desta montagem que eu não consegui testar de ponta a ponta antes de entregar, porque depende do comportamento real dos servidores do Google, que só existe depois que você implanta o seu próprio Apps Script — não dá para simular isso com antecedência. É uma técnica amplamente usada e documentada (páginas estáticas conversando com Apps Script), então a expectativa é que funcione direto, mas se não funcionar, me mande a mensagem de erro exata que aparece no console (F12 > aba Console) que eu ajusto o código.

---

## Onde tudo fica guardado

- **Planilha Google** ("Plansul — Fluxo de Caixa — Dados"): usuários (com senha em formato protegido, nunca em texto puro), contas bancárias, metadados dos relatórios e o histórico de uploads.
- **Pasta "Plansul - Fluxo de Caixa - Arquivos" no seu Google Drive**, criada automaticamente, com duas subpastas:
  - `fontes`: os lançamentos já processados de cada banco (o que alimenta o painel).
  - `originais`: uma cópia do arquivo Excel/CSV exatamente como foi enviado, para consulta ou auditoria futura.

## Gerenciar usuários e senhas depois

Sempre pela planilha, menu **Plansul**:
- **Criar novo usuário** — cadastra alguém novo.
- **Definir senha de usuário** — troca a senha de alguém que já existe.

Não existe (de propósito) uma forma de ver a senha de alguém depois de cadastrada — só trocar por uma nova.

## Sobre a segurança deste modelo

As senhas nunca ficam no código do site (que é público, por causa do GitHub Pages gratuito) — elas são conferidas dentro do Google Apps Script, que roda só no Google, e nunca aparecem no navegador de quem está usando o painel. Isso é bem mais seguro do que a ideia original de colocar as senhas direto no código da página.

Ainda assim, é uma segurança pensada para manter pessoas de fora e acessos casuais longe — não é o mesmo nível de um sistema corporativo com contas individuais de verdade (é isso que a conta Claude Team/Enterprise ofereceria, se decidirem seguir por esse caminho no futuro).

## Limite de uso gratuito

O Google Apps Script gratuito é bem generoso para o tamanho deste painel: cada chamada individual (login, salvar, carregar dados) pode rodar até 6 minutos antes de ser interrompida — na prática leva menos de 1 segundo — e permite até 30 chamadas simultâneas por pessoa. Não deve ser um problema no dia a dia normal do financeiro e da diretoria, mesmo com o painel atualizando sozinho a cada 45 segundos.
