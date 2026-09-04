# Plansul — Fluxo de Caixa — Fase 2

Data: 04/09/2026

## Objetivo
Transformar o painel em uma visão de Tesouraria e Fluxo de Caixa mais confiável, separando caixa operacional de aplicações e destacando risco de liquidez.

## Alterações implementadas

1. KPIs filtrados pela competência selecionada.
2. Saldo bancário projetado calculado sem aplicações financeiras.
3. Disponibilidade financeira calculada como saldo bancário projetado + aplicações.
4. Curva diária de caixa com saldo histórico e projeção futura.
5. Menor saldo projetado e respectiva data crítica.
6. Indicador **Necessidade de Caixa** = valor mínimo necessário para impedir saldo bancário negativo no menor ponto do período.
7. Posição por banco limitada a contas correntes e ao período selecionado.
8. `accountId` estável para relacionamento entre contas e movimentos, com fallback por nome para bases antigas.
9. Novos uploads incluem `id`, `sourceId`, `importId` e `accountId`.
10. Validação de data, tipo, status e valor antes da gravação no backend.
11. Lock de escrita para evitar importações simultâneas.
12. Rollback básico em falhas de gravação de fontes e aplicações.
13. Dataset consolidado `_consolidated.json`, reconstruído após importação/exclusão, para reduzir custo do polling.
14. Logout com invalidação de sessão no backend.
15. Hash de senha iterativo/versionado, com migração automática de hashes legados após login válido.
16. Título do gráfico alterado para **Evolução e projeção do caixa**, exibindo o intervalo real selecionado.

## Implantação

### Frontend
Substituir no site os arquivos `app.js`, `styles.css`, `index.html` e `diretoria.html` pelos arquivos desta versão.

### Google Apps Script
Substituir o conteúdo do `Code.gs` pelo desta versão e criar uma **nova implantação** do Web App. Se a nova implantação gerar outra URL `/exec`, atualizar `APPS_SCRIPT_URL` no início de `app.js`.

Não é necessário apagar as abas ou os dados atuais. O vínculo por nome continua funcionando e será complementado por `accountId` nos novos uploads.

## Observação de segurança
A melhoria de senha é a melhor alternativa implementada dentro do stack Apps Script sem biblioteca externa. Para uma futura arquitetura corporativa dedicada, ainda é recomendável migrar autenticação para um provedor/serviço próprio com Argon2/bcrypt/PBKDF2 robusto, SSO ou identidade corporativa.
