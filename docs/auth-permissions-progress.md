# TavernSound — autenticação, permissões e acesso ao Google

Atualização de 25/09/2026. Branch local: `fix/initial-production-review`.

## Implementado nesta etapa

- A API cria sessões de sete dias na tabela `Session`, já existente no schema.
  O cookie contém identificador, emissão, expiração e assinatura HMAC. O banco
  armazena somente um hash do identificador aleatório da sessão.
- A autenticação verifica assinatura, formato, expiração e existência da sessão
  no banco. Logout remove a sessão persistida e desconecta seus sockets na mesma
  instância da API. Cada evento Socket.IO revalida a sessão e o acesso à sala;
  conexões também têm um temporizador para o vencimento da sessão.
- Login Google vincula a tentativa ao navegador por `state` aleatório e cookie
  temporário, inclui PKCE, exige e-mail verificado e limita redirecionamentos a
  caminhos internos. A identidade Google é persistida em `Account`. Não se
  vincula automaticamente uma identidade Google nova a uma conta de senha.
- Mutações do frontend exigem a origem esperada. A API rejeita mutações de
  navegadores de outra origem; o handshake Socket.IO também verifica origem.
- Sala privada exige dono ou participação ativa registrada no banco. Salas
  públicas sem senha admitem contas autenticadas. Salas sem dono não transferem
  automaticamente o papel de mestre ao primeiro visitante.
- O mestre pode autorizar pelo e-mail uma conta já cadastrada; o formulário
  aparece na sala. O procedimento concede acesso e não envia mensagens/e-mails.
- A página inicial lista até 100 salas pertencentes ao usuário ou das quais ele
  participa. Falhas de autenticação e acesso têm mensagem visível.
- Voz exige sessão válida e acesso à sala. O UID Agora é derivado no servidor,
  vinculado à sessão; o cliente não pode escolher outro UID. Tokens duram no
  máximo cinco minutos ou até o fim da sessão, o que ocorrer antes; o cliente
  solicita renovação quando o SDK avisa que o token vai vencer.
- Novos cadastros exigem senha de ao menos 12 caracteres, com limite de 72 bytes
  do bcrypt; login de contas antigas continua aceitando senhas menores.
  Campos de credenciais são validados e e-mail é normalizado.

## Validação

- **56 testes, 10 suites, passando.**
- Testes unitários de expiração, adulteração, revogação, origem, redirecionamento,
  state OAuth, permissões, identidade de voz e validação de credenciais.
- Testes de integração iniciam NestJS e conexões Socket.IO reais: rejeitam
  visitantes anônimos/origens externas, bloqueiam entrada em sala privada,
  permitem o dono entrar, desconectam no logout HTTP e negam tokens de voz.
- O banco usado nesses testes é um substituto em memória. Não houve validação
  contra um PostgreSQL real nesta etapa.
- Build API e build web concluídos. Os avisos anteriores de middleware e
  lockfiles duplicados continuam; atualizações de dependências estão pendentes.

## Efeitos ao atualizar

Cookies emitidos pela versão antiga serão rejeitados: todos precisarão fazer
login novamente. A implementação usa `Session`, `Account` e `RoomMember` já
existentes; não requer nova migração do schema nesta etapa. Registros históricos
ativos em `RoomMember` contam como participação. Deve-se revisar membros legados
antes de abrir o produto ao público.

Contas de senha não podem usar automaticamente o botão Google: precisam entrar
com a senha até existir um fluxo explícito de vinculação. Ainda faltam confirmação
de e-mail, recuperação de senha, limitação de tentativas e controles completos
de gestão/revogação de membros.

## Limites que permanecem

Não foram exercitados login real com Google, áudio com microfones, renovação real
Agora, PostgreSQL ou cobrança. A revogação imediata de sockets usa um evento no
processo; múltiplas instâncias precisam de um mecanismo compartilhado. Um token
Agora já emitido pode continuar válido por até cinco minutos. O middleware web
verifica o cookie localmente, mas a autorização dos dados depende da consulta
da API à sessão persistida.

A topologia publicada ainda precisa resolver o uso de cookies entre frontend
e API: CORS/`withCredentials` não compartilham cookies host-only entre domínios
independentes. Não publicar frontend e API em URLs separadas sem proxy adequado
ou mecanismo específico de autenticação entre eles.

Persistência/reconexão de tokens, editor de paredes/portas, névoa, lifecycle
completo de áudio, rate limiting, dependências vulneráveis, backups e operação
continuam no plano de produção. Esta etapa não torna o projeto pronto para
lançamento público.

## Ferramentas Google

Instaladas localmente para este trabalho, fora do repositório:

- Firebase CLI **15.31.0**.
- Google Cloud SDK **586.0.0**, obtido do arquivo oficial com SHA-256 verificado.

Os logins de ambas as ferramentas foram confirmados em 25/09/2026. Foram
encontrados dois projetos ativos: `tavernsound` e `tavernsound-vtt`. A escolha
do projeto alvo foi confirmada pelo usuário: **`tavernsound-vtt`**.
Nenhum projeto, banco, recurso de hospedagem, faturamento ou permissão IAM foi
criado/alterado. Ambos os projetos estão com `billingEnabled: false`. A consulta
ao Firestore retornou `SERVICE_DISABLED` para `firestore.googleapis.com` em
ambos; isso não confirma a existência ou ausência de um banco. A API não foi
habilitada durante a inspeção.

Próximo passo de infraestrutura: inspecionar os
recursos existentes e preparar uma configuração revisável antes de provisionar
ou publicar. O acesso do Drive/Calendar conectado ao Codex é
separado da autenticação dessas ferramentas.

## Restrição de orçamento e próxima etapa

Atualização posterior: o usuário autorizou preparar proteções locais e modelos
App Hosting/Cloud Run para uma possível implantação com faturamento no futuro.
Faturamento continua desativado; consulte `docs/test-safety.md` para o estado
mais recente, limites implementados e verificações. A restrição de custo zero
abaixo registra a proposta anterior, não uma autorização de gastos.

O usuário definiu custo inicial **zero**, sem orçamento para serviços pagos.
Não habilitar faturamento ou depender de créditos temporários para manter o
produto. Firebase App Hosting e Cloud Run exigem faturamento habilitado, portanto
não compõem a proposta inicial sob essa restrição. Firebase Hosting tradicional
tem plano Spark, mas não executa sozinho a aplicação atual Next.js dinâmica,
API NestJS, Socket.IO e PostgreSQL. Firestore não substitui automaticamente o
banco PostgreSQL usado pelo código.

A hospedagem gratuita ainda precisa ser escolhida e validada para uma beta,
incluindo limites, suspensão ao atingir cotas, persistência do banco e suporte
a WebSocket. Não há infraestrutura de produção publicada ou disponibilidade
garantida. Não usar um banco gratuito que expire como armazenamento permanente.

O usuário conseguiu acessar o console Agora abrindo uma nova guia. A configuração
das credenciais ainda está pendente. Não houve teste real de voz.
Enquanto isso, podem avançar correções de dependências vulneráveis, persistência
e reconexão das salas e testes locais do áudio espacial. Antes de ativar voz
pública, validar cotas e controles de consumo para respeitar o orçamento.

Referências de custo:
[Firebase pricing](https://firebase.google.com/pricing),
[App Hosting](https://firebase.google.com/docs/app-hosting/costs),
[Cloud Run com Hosting](https://firebase.google.com/docs/hosting/cloud-run).

Referências: [gcloud auth login](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login),
[Firebase CLI](https://firebase.google.com/docs/cli),
[arquivos oficiais do SDK](https://docs.cloud.google.com/sdk/docs/downloads-versioned-archives).
