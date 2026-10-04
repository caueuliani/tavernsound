# TavernSound — revisão inicial para produção

> Registro histórico da revisão inicial. Para as correções posteriores de
> autenticação e permissões, consulte `auth-permissions-progress.md`.

Base: `caueuliani/tavernsound`, commit `78bc5e1`, branch local
`fix/initial-production-review`. Revisão em 24/09/2026.

## Conclusão

É possível evoluir esta base para um produto público, mas ela ainda é um
protótipo. Compilar não comprova que uma sessão multiplayer completa funciona.
Esta entrega corrige bloqueios iniciais e registra o trabalho restante;
não representa uma certificação de segurança nem uma versão pronta para publicar.

O objetivo informado é um VTT público com contas, salas e áudio espacial.
O usuário informou uso de tokens temporários Agora, ausência de hospedagem,
possível configuração Firestore no console e decisão pendente entre Stripe e Asaas.
Nenhuma infraestrutura externa foi acessada ou alterada nesta revisão.

## Arquitetura encontrada

| Parte | Implementação no repositório |
| --- | --- |
| Interface | Next.js 16, React 19, mapa PixiJS; grade fixa de 10 × 10 células |
| Tempo real | NestJS + Socket.IO; jogadores e salas mantidos em Maps no processo |
| Dados | PostgreSQL via Prisma 6 na API; Prisma 7 também presente na raiz |
| Autenticação | Cookie próprio assinado com HMAC; login de senha e Google manual |
| Áudio | Agora RTC; HRTF, distância e filtro de oclusão no Web Audio |
| Cobrança | Esqueleto Stripe com checkout e webhooks |
| Operação | Sem pipeline de implantação ou provisionamento versionado encontrado |

Não encontrei SDK, configuração ou chamadas Firestore no código. Um banco criado
no console Firebase não conecta automaticamente esta implementação a ele.

## Correções incluídas

- Imports inexistentes de sessão nas rotas de autenticação do frontend.
- Imports de tipos incompatíveis com a configuração de decorators do NestJS.
- Remoção de `@types/socket.io-client` v1, que conflita com Socket.IO v4.
- Correção de acesso a `anchor.position` no PixiJS e checagem de canvas nulo.
- Suspense nas páginas de login e planos, necessário para concluir o build.
- Histórico de dados passa a usar `timestamp`, conforme o schema Prisma.
- Histórico de chat filtra o campo `roomId` do JSON, em vez de comparar o objeto inteiro.
- Dono da sala preservado em memória desde a criação, evitando que o primeiro
  participante receba poderes de mestre indevidamente.
- Criação de sala exige sessão válida.
- Edição de HP/imagem exige que o token exista na sala atual, inclusive para o mestre.
- Criação de token não usa mais upsert por ID arbitrário: um ID existente não
  pode sobrescrever outro token; a memória só é atualizada após salvar no banco.
- API rejeita assinatura de sessão quando nenhum segredo está configurado.
- Cookies enviados nas conexões Socket.IO e no pedido do token Agora.
- Distância de referência do áudio ajustada para uma célula; novos emissores
  começam silenciosos até suas posições serem identificadas; deafen usa estado atual.
- API respeita `PORT`, escuta em `0.0.0.0` e habilita encerramento dos providers.
- Exemplos de ambiente e instruções de instalação adicionados.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Instalação pelo lockfile raiz | 905 pacotes instalados; scripts inicialmente desabilitados |
| Geração explícita do Prisma Client da API | Passou, versão 6.19.2 |
| Build API | Passou |
| Build web, tipos e pré-renderização | Passou; 15 páginas geradas |
| Jest API | 3 suites, 8 testes passando |
| Novas regressões cobertas | Segredo ausente/incorreto, fallback de segredo, sala anônima, dono em memória, edição de token externo, conflito de ID |
| Auditoria npm da base instalada | 57 alertas: 2 baixos, 21 moderados, 31 altos, 3 críticos |

A auditoria inclui dependências de desenvolvimento; não mede por si só a
explorabilidade do aplicativo. Os pacotes classificados como críticos incluem
Next.js, next-auth e Handlebars. A remoção dos tipos antigos não é uma correção
dos alertas. Atualizações de segurança permanecem pendentes.

Não foram executados testes reais com PostgreSQL, login Google, microfones,
Agora, webhooks de pagamento, múltiplos navegadores ou carga. Nenhuma variável
de ambiente com credenciais foi fornecida. O e2e original ainda espera
`Hello World!` e precisa ser substituído. Permanecem avisos sobre dois lockfiles
e a convenção middleware do Next.js.

## Bloqueios restantes, em ordem

### P0 — antes de expor publicamente

1. **Dependências vulneráveis.** Atualizar versões e lockfile com análise das
   mudanças, repetir auditoria, builds e testes. Evitar `audit fix --force`
   indiscriminado. Consolidar Prisma e remover bibliotecas realmente não utilizadas.
2. **Sessões e OAuth.** O payload assinado não tem expiração validada no servidor;
   logout só remove o cookie. O fluxo Google usa o callback como `state` sem
   vinculá-lo a uma tentativa de login. Implementar nonce/state verificável,
   redirecionamentos internos permitidos, expiração e revogação de sessão.
   Referências: `apps/web/app/lib/session.ts`, `apps/web/middleware.ts`,
   `apps/web/app/api/auth/google/route.ts` e callback Google.
3. **Autorização de sala/voz.** `join-room` ainda admite participantes sem sessão;
   `isPublic`, senha e membros do schema não controlam a entrada. A emissão de
   token Agora verifica login, mas não associação à sala nem identidade de UID.
   Exigir associação/convite no servidor e derivar papel e identidade da sessão.
4. **Validação e abuso.** DTOs são apenas tipos TypeScript. Limitar e validar
   eventos, coordenadas, IDs, paredes, arquivos, fórmulas e frequência; adicionar
   limites em login/cadastro e evitar vazamento de erros do banco.
5. **Topologia de autenticação.** Cookies host-only não serão compartilhados entre
   URLs independentes App Hosting/Cloud Run. Definir proxy/origem ou autenticação
   explícita de socket; testar cookies, CORS e CSRF na topologia real.

### P1 — mesa utilizável e confiável

6. **Persistência e reconexão.** Tokens não guardam dono estável no banco; ao
   restaurar, `playerId` vira o ID do token. Desconexão remove tokens da memória
   mas os mantém no banco. Definir dono por usuário, reconexão idempotente,
   troca de sala e recuperação sem duplicação. O cliente também indexa tokens
   por jogador, enquanto o servidor admite vários tokens por jogador.
7. **Estado do mapa.** A interface emite `fog-update`, mas não há handler no
   gateway. Paredes e configurações de áudio ficam só na memória; a interface
   Grid não integra essas paredes ao hook de áudio. Persistir e reidratar estado,
   criar editor de paredes/portas e testar mestre versus jogador.
8. **Ciclo de vida do áudio.** Reidratar o mapeamento de UIDs dos jogadores já
   presentes; renovar token Agora; cancelar inicializações assíncronas após
   desmontagem; remover apenas listeners do próprio hook; tratar permissão de
   microfone e AudioContext suspenso; validar mute/deafen e reconexões.
   As alterações desta entrega não resolvem todo esse ciclo.
9. **Regras autoritativas.** Rolagens são aceitas do cliente, inclusive resultado.
   Gerar no servidor; aplicar cotas de sala/jogadores sem corrida; permitir listar,
   reabrir e excluir salas para não prender a conta ao limite do plano gratuito.
10. **Arquivos e UX.** Mapas/imagens são transmitidos como base64 e armazenados no
    banco. Mover para armazenamento de objetos com limites e autorização;
    melhorar erros visíveis, estados de carregamento, zoom/pan e tamanho de mapa.

### P2 — operação e cobrança

11. **Implantação.** Pipeline com build/teste, staging separado, migrações,
    segredos, logs estruturados, métricas, readiness do banco, backups testados
    e rollback. Várias instâncias exigem estado compartilhado e coordenação;
    um adapter Socket.IO sozinho não compartilha os Maps de regras da aplicação.
12. **Pagamentos.** Escolher Stripe ou Asaas antes de finalizar integração;
    validar URLs de retorno, idempotência, eventos fora de ordem, trial,
    cancelamento, inadimplência e mudança de plano. Confirmar regras comerciais.
    Não ativar cobrança antes de validar o produto com grupos reais.

## Proposta Google, sem provisionamento nesta etapa

Minha recomendação inicial é preservar NestJS e PostgreSQL para aproveitar o
código existente. Firestore é possível, mas exige redesenhar consultas,
transações, persistência e controle de acesso; não é troca de variável de ambiente.

- Frontend Next.js: **Firebase App Hosting**, que suporta aplicações Next.js
  dinâmicas. [Documentação](https://firebase.google.com/docs/app-hosting/get-started).
- API NestJS/Socket.IO: **Cloud Run**, com endpoint e autenticação definidos
  explicitamente, reconexão testada e plano para estado compartilhado.
  Cloud Run aceita WebSockets, mas tem timeout e exige sincronização entre
  instâncias. [Documentação](https://docs.cloud.google.com/run/docs/triggering/websockets).
- PostgreSQL gerenciado para os modelos existentes; provedor e orçamento a decidir.
- Armazenamento de objetos para mapas/imagens e segredos apenas no servidor.
- Agora com emissão e renovação de tokens no backend; certificado nunca no cliente.

App Hosting exige plano Blaze. Não foi estimado custo: quantidade de salas,
horas de voz, usuários simultâneos, região e retenção ainda não foram definidos.
Nenhum serviço pago foi criado.

## Critério proposto para a primeira versão pública

Uma conta consegue registrar, entrar, recuperar acesso, criar/reabrir/excluir
uma sala, convidar participantes e controlar papéis. Um grupo consegue jogar
com tokens, mapa, paredes, portas, chat e dados sincronizados. O áudio varia
com posição e obstáculos, respeita mute/deafen e permanece funcional após
reconexão e renovação de token. Reiniciar o servidor preserva a mesa.

Testes devem cobrir dois ou mais navegadores, tentativa de acesso indevido,
eventos inválidos, reconexão, restauração de backup e uma sessão longa que
ultrapasse a validade do token de voz. Definir capacidade e orçamento-alvo antes
do teste de carga. A liberação pública depende dos P0 resolvidos, P1 validado
com usuários e operação preparada; cobrança pode ser uma etapa posterior.
