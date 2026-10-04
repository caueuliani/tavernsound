# Beta fechada: proteções de uso e preparação Google

Atualizado em 25/09/2026. Projeto escolhido: `tavernsound-vtt`.
Implementação local; faturamento, recursos Google e implantação não foram alterados.

## Controles implementados

- `TEST_MODE` é ligado por padrão. Somente `false` o desliga; valor inválido falha.
- `TEST_ALLOWED_EMAILS` na API restringe cadastro, login por senha, Google,
  sessões existentes e autorização de participantes. Lista vazia bloqueia todos.
  Não se deve colocar essa lista em variável pública do frontend.
- Uma sala cadastrada no banco durante a beta, cinco conexões de participantes,
  uma conexão por conta. O limite inclui o mestre. Salas antigas podem ser usadas,
  mas só uma pode ter uma sessão ativa; nenhuma sala antiga é apagada.
- Uma janela global de até 60 minutos por dia UTC, reservada na primeira entrada.
  Perto de 00:00 UTC, a janela termina na virada do dia. Desconectar não devolve
  minutos e reconectar usa o prazo original. Novo dia permite nova janela.
- Máximo de 20.000 operações de aplicação por dia UTC, compartilhadas entre
  HTTP, handshakes autenticados e eventos Socket.IO. Não é uma contagem de
  todas as requisições de infraestrutura ou de operações reais do banco.
- `TestBudget` persiste cotas, prazo e participantes. Transações PostgreSQL com
  `SELECT FOR UPDATE` serializam mudanças na mesma linha. Não apagar essa linha
  em deploys. Erro no banco ou migração ausente bloqueia as operações protegidas.
- Participantes têm reservas de 90 segundos, renovadas a cada 30 segundos.
  Uma queda abrupta pode exigir aguardar até 90 segundos para reconectar.
  Na ausência de renovação, a reserva expira. Não se armazena o ID de sessão
  em texto aberto nessa tabela; somente seu hash.
- Timer encerra sockets no prazo, mesmo sem novos eventos. Heartbeat revalida
  sessão, permissão e cota; falha encerra a conexão. Sockets que não entram em
  uma sala são fechados após 60 segundos.
- Voz exige reserva ativa da mesma conta/sessão/sala. Tokens não ultrapassam
  o prazo da reserva nem da janela. A voz pode encerrar cerca de 30 segundos
  antes do fim para evitar renovações repetidas de um token quase expirado.
  Uma credencial já emitida pode continuar válida até expirar, mesmo depois
  de uma desconexão. A validação real pelo Agora ainda está pendente.
- Uploads de mapa e imagem de token são bloqueados no servidor e escondidos
  na interface. Mensagens Socket.IO têm limite de 16 KiB, inclusive fora da beta;
  para reabrir uploads, planejar armazenamento próprio e rever esse limite.
- Checkout e webhook de pagamentos são bloqueados no modo de testes.
- Limites curtos em memória: HTTP 120/min por IP observado e 60/min por usuário;
  POST de autenticação 10/min por IP; conexões Socket.IO 10/min por IP;
  eventos 20/s por usuário e 60/s por IP. A camada web limita as rotas `/api`
  a 120/min por processo antes dos handlers. Limites curtos reiniciam com o
  processo; cotas diárias permanecem no banco.
- Não se confia no `X-Forwarded-For` fornecido pelo cliente. Por isso, chamadas
  atrás de um proxy podem compartilhar o limite de IP. Revisar a topologia
  confiável antes de ajustar isso; não habilitar `trust proxy=true` indiscriminadamente.

## Configuração local

1. Preencher os `.env` privados seguindo os exemplos. Usar PostgreSQL local;
   não rodar migrações contra um banco remoto sem revisar o destino.
2. Na pasta `apps/api`, gerar o Prisma Client e aplicar as migrações, incluindo
   `20260925000000_test_budget`. A geração do client não altera o banco.
3. Manter `TEST_MODE=true` na API e no web. Informar os e-mails autorizados
   somente na API. A aprovação de um e-mail permite cadastro, mas não concede
   automaticamente acesso a uma sala privada: o mestre ainda autoriza a conta.
4. Iniciar API e frontend. Uma reserva de janela não é reembolsada ao sair.

## Preparação de implantação (não aplicada)

- `apps/web/apphosting.yaml`: mínimo zero, máximo uma instância, CPU 1,
  memória 512 MiB, concorrência 10, modo de testes ligado.
- `deploy/cloud-run-api.yaml.example`: modelo equivalente para API, timeout
  de 3.600 segundos. Imagem, URLs, segredos, identidade IAM e região ainda devem
  ser preenchidos e revisados. O arquivo não é implantável como está.
- `deploy/Dockerfile.api`: preparação de contêiner com usuário sem privilégios.
  Docker não está instalado neste ambiente; a imagem ainda não foi construída.
- Deploys devem ser manuais. Desativar rollouts automáticos nas configurações
  do backend App Hosting quando ele for criado; o YAML sozinho não faz isso.
- Configurar alerta de orçamento e spend cap para Cloud Run antes dos testes
  publicados, abrangendo os serviços de web e API. Ainda não foram configurados.
- O banco atual é PostgreSQL. Firestore não é substituto automático e não foi
  provisionado um banco nesta etapa.
- Resolver autenticação HTTP e Socket.IO entre os domínios finais antes de
  publicar: os cookies host-only atuais não são compartilhados entre o domínio
  App Hosting e o domínio Cloud Run. Os arquivos não resolvem esse bloqueio.

## Limites de garantia e segurança financeira

Essas cotas limitam uso da aplicação; não medem reais/dólares e não garantem
fatura zero. Requisições rejeitadas, conexões ao transporte, builds, imagens,
tráfego e banco podem consumir recursos fora desses contadores. O contador
diário também faz transações de banco, que precisam entrar na estimativa.
Limites máximos de instâncias não são limites monetários e podem ter exceções
transitórias da plataforma. O estado da mesa ainda usa memória local; não
presumir que a proteção de cotas torna o jogo pronto para múltiplas instâncias.

App Hosting exige faturamento. Spend caps são uma proteção em prévia e podem
permitir excedentes por atraso; não cobrem automaticamente todos os serviços.
O Agora tem contabilização própria e requer verificação separada de consumo.

O usuário pode cadastrar cartão e criar a conta de faturamento diretamente
no Google. Uma conta já existente pode ser vinculada por CLI se houver
permissão IAM e autorização explícita do usuário. Nenhum desses passos foi
executado aqui. Não enviar dados de cartão, senhas ou certificados pelo chat.

## Verificação e pendências

Verificação local: **73 testes em 11 suítes passaram**, além dos builds da
API e do frontend. Prisma Client foi regenerado; nenhuma migração foi aplicada
a banco remoto. A lista de e-mails nos modelos permanece vazia até configuração
privada dos participantes. Os avisos existentes de middleware legado e lockfiles
duplicados no build Next.js continuam pendentes.

Testes de política e de integração HTTP/Socket.IO cobrem bloqueios, expiração,
reconexão, reserva compartilhada, cotas diárias, falhas de banco e uploads.
O banco dos testes é um substituto transacional em memória: não comprova locks
sob concorrência real do PostgreSQL. Antes de publicar, aplicar migrações e
repetir as disputas por vagas/cotas em PostgreSQL real, testar dois navegadores
e microfones com Agora, corrigir dependências vulneráveis e validar domínio/cookies.

Referências:
- [Configuração App Hosting](https://firebase.google.com/docs/app-hosting/configure)
- [Cloud Run YAML](https://docs.cloud.google.com/run/docs/reference/yaml/v1)
- [Custos App Hosting](https://firebase.google.com/docs/app-hosting/costs)
- [Spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
