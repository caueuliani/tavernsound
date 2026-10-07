# Beta gratuita com amigos: Render + Neon

Estado em 25/09/2026: ajustes locais aplicados e testados. Nenhuma implantação
remota, commit/push, conta de banco ou alteração de faturamento foi realizada.
O usuário já tem conta Render; falta a conta/projeto Neon.

## O que mudou

- Um serviço Render Free atende Next.js e NestJS por um proxy HTTP/WebSocket.
  O navegador usa `/backend/*` para a API e `/socket.io/*` para as salas no
  mesmo endereço do site. Os processos internos escutam somente em loopback.
  O proxy tem destinos fixos, remove cabeçalhos internos fornecidos pelo cliente
  e não expõe a troca interna de identidade Google.
- Redirecionamentos de login e OAuth usam a origem pública, sem expor portas
  internas. `PUBLIC_ORIGIN` ou `RENDER_EXTERNAL_URL` define essa origem.
- `render.yaml` usa `plan: free`, um serviço, sem banco Render, sem deploy
  automático. Não configurar `NEXT_PUBLIC_API_URL` no Render.
- Next.js atualizado para **16.3.6**, Nest core **11.2.6**, Prisma **6.19.3**.
  Dependências sem uso do frontend (NextAuth, Prisma e bcrypt) foram removidas,
  assim como o Prisma 7 e Stripe duplicados na raiz e o lockfile do web.
- O override restrito `@prisma/config > deepmerge-ts ^8` corrige o alerta
  GHSA-ggr8-5vv4-36mx. A mudança de major é limitada à configuração Prisma;
  geração do client e migrações reais passaram com ela. Revisar/remover o
  override quando o upstream corrigir sua dependência.
- Auditoria npm após a instalação: **0 vulnerabilidades conhecidas**,
  comparadas às 57 do levantamento inicial. Isso não substitui revisão de código.
- A configuração Prisma usa `DATABASE_URL` para execução e `DIRECT_URL` para
  migrações. No Neon, usar conexão com pooler para execução e conexão direta
  para migrações; preservar os parâmetros TLS fornecidos pelo painel.
- As proteções de `docs/test-safety.md` continuam ativas, com lista de e-mails
  vazia nos exemplos. Nenhuma conta real foi autorizada automaticamente.

## Verificações concluídas

- 73 testes da API e 3 testes de proxy HTTP/WebSocket passaram.
- Builds API e Next passaram, sem os avisos antigos de middleware e lockfiles.
- As três migrações foram aplicadas a um PostgreSQL **18.4 local real**,
  acessível somente em `127.0.0.1:55432`, usando credenciais descartáveis.
- Teste com dois Prisma Clients verificou disputa por criação de sala,
  cinco vagas concorrentes, manutenção do prazo após recriar o serviço e
  atomicidade da última operação permitida na cota diária.
- Teste integrado da aplicação compilada validou cadastro, login, cookie,
  API HTTP, criação/entrada em sala por WebSocket, logout com desconexão e
  rejeição de reutilização do cookie revogado, todos pelo mesmo endereço.
- O teste integrado também verificou redirecionamentos públicos. Login real
  Google, voz Agora e dois navegadores com microfones ainda não foram exercitados.

## Publicar quando as contas e credenciais estiverem prontas

1. Criar projeto no **Neon Free** em região próxima à escolhida no Render.
   Não habilitar plano pago. Guardar as URLs de conexão somente em configuração
   privada; elas incluem senha. Não colar as URLs no chat nem no Git.
2. Aplicar as migrações ao banco novo escolhido, após conferir o destino.
   Na raiz, com as variáveis carregadas: `npm run db:migrate`. Esse comando não
   roda automaticamente no build nem quando o servidor acorda. No plano grátis,
   não depender de pre-deploy jobs ou shell remoto do Render.
3. Levar a versão revisada do código ao GitHub e criar o serviço pelo Blueprint
   `render.yaml`, verificando o plano **Free** e deploy automático desligado.
   Nenhum serviço foi criado nesta etapa.
4. Configurar `TEST_ALLOWED_EMAILS`, `DATABASE_URL`, `DIRECT_URL`,
   `SESSION_SECRET`, `INTERNAL_API_SECRET` e as três variáveis Agora abaixo.
   O Blueprint gera os dois segredos de sessão/interno. Manter `TEST_MODE=true`.
   Nunca usar os segredos descartáveis do teste local na implantação.
5. O endereço `https://…onrender.com` é detectado automaticamente pelo processo
   inicial. Para um domínio próprio, informar `PUBLIC_ORIGIN`.
6. Começar com login por e-mail/senha. Para habilitar login Google, cadastrar
   `https://…onrender.com/api/auth/google/callback` no cliente OAuth correto e
   configurar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Render.
7. Testar com duas contas autorizadas; o mestre deve conceder participação
   na sala. Só então compartilhar o link com o restante do grupo.

## Agora: credenciais necessárias

O código usa **App ID + App Certificate**, não Customer ID/Customer Secret de
REST API e não um token temporário colado no frontend.

1. Abrir [Agora Console](https://console.agora.io/) e entrar na conta.
2. Em **Project Management / Projects**, selecionar o projeto do TavernSound
   ou criar um projeto de testes. Escolher autenticação por token/App Certificate.
3. Copiar o **App ID** do projeto para `AGORA_APP_ID` e
   `NEXT_PUBLIC_AGORA_APP_ID` (mesmo valor).
4. Em **Configure / Config → Security → App Certificate**, habilitar o
   **Primary Certificate** se estiver desativado e copiar para
   `AGORA_APP_CERTIFICATE`, exclusivamente no servidor.
5. Usar autenticação que exija token. Se o projeto antigo ainda permitir acesso
   sem certificado, revisar/desativar esse modo no projeto de testes antes de
   compartilhar o App ID publicamente. Não rotacionar um certificado de outro
   projeto já em uso.
6. Não enviar o certificado em chat ou screenshot. O servidor emite tokens
   curtos automaticamente. Conferir o consumo/franquia na própria conta Agora
   antes da sessão com amigos; hospedagem gratuita não garante voz gratuita.

## Limitações ainda abertas

Render Free pode dormir, reiniciar e suspender ao atingir cotas. Sem cartão,
consumo excedente de tráfego/builds pode suspender serviços/builds em vez de
gerar cobrança. As 750 horas gratuitas são compartilhadas pelo workspace.
O Neon Free também tem limites próprios. Não usar o Postgres gratuito do Render
como banco permanente: ele expira em 30 dias.

A memória disponível do plano Render e o cold start ainda precisam de medição
na implantação real; build local aprovado não garante que toda carga caiba
no plano Free. O estado em memória das mesas e a restauração de propriedade
dos tokens após reconectar ainda precisam de trabalho. Os testes feitos não
garantem uma partida sem perda de estado em um reinício do serviço.

Referências:
- [Render Free](https://render.com/docs/free)
- [Render Blueprint](https://render.com/docs/blueprint-spec)
- [Neon: planos](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md)
- [Agora: projetos e credenciais](https://github.com/AgoraIO-Conversational-AI/hackathon-2026-03-20-agora-preply/blob/main/docs/guide.md)
