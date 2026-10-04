# TavernSound

Protótipo de VTT com Next.js/React/PixiJS, API NestJS/Socket.IO,
PostgreSQL/Prisma e voz Agora com processamento espacial via Web Audio.
Ainda não está pronto para lançamento público. Consulte `docs/production-review.md`.
O progresso mais recente e a implantação gratuita estão em `docs/render-beta.md`.

## Desenvolvimento

1. Instale Node.js e npm; execute `npm ci` na raiz do monorepo.
2. Copie `apps/api/.env.example` para `apps/api/.env` e
   `apps/web/.env.example` para `apps/web/.env.local`.
3. Configure um PostgreSQL de desenvolvimento em `DATABASE_URL` e `DIRECT_URL`.
   O projeto atual **não usa Firestore**.
4. Gere segredos aleatórios distintos para `SESSION_SECRET` e
   `INTERNAL_API_SECRET`; configure os mesmos valores na API e no web.
   Exemplo de geração local: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. Na pasta `apps/api`, execute `npx prisma generate` e
   `npx prisma migrate deploy`. O monorepo agora usa somente Prisma 6.19.3
   e um único lockfile na raiz.
6. Em terminais separados na raiz, execute `npm run dev:api` e `npm run dev:web`.
7. Mantenha `TEST_MODE=true` em ambos os serviços e preencha
   `TEST_ALLOWED_EMAILS` na API com os e-mails autorizados, separados por vírgula.
   A lista vazia bloqueia todos. Abra `http://localhost:3000` e cadastre uma
   dessas contas. O modo de testes permite uma sala e uma janela de até uma
   hora por dia UTC; reiniciar ou desconectar não devolve a reserva.

Para jogar em uma sala privada, o mestre deve usar **Autorizar participante**
com o e-mail da conta cadastrada, depois compartilhar o código da sala.
As salas autorizadas também aparecem na página inicial. Cookies da versão antiga
não são mais aceitos; faça login novamente após atualizar.

Para voz, configure o App ID Agora no frontend e backend e o certificado
somente no backend. A implementação solicita tokens ao backend; não há
campo de token temporário fixo no cliente. Credenciais de produção não
devem ser usadas para testes locais.

## Verificação

Na raiz, após gerar o Prisma Client:

```sh
npm run build:api
npm run build:web
npm test --workspace=api -- --runInBand
npm run test:proxy
```

Os scripts `deploy/database-check.mjs` e `deploy/smoke.mjs` também foram
executados contra PostgreSQL local real. Eles exigem o banco local descartável
`tavernsound_test` e não devem apontar para dados de usuários. Ainda faltam
dois navegadores com microfones e expiração/renovação real dos tokens Agora.

## Implantação

`render.yaml` prepara uma beta no Render Free com Neon PostgreSQL. `npm start`
inicia um endereço público único, com web e API em portas locais privadas.
HTTP e Socket.IO compartilham o cookie; não configurar `NEXT_PUBLIC_API_URL`
nesse modo. Não foram criados serviços remotos ou habilitado faturamento.
Consulte `docs/render-beta.md` antes de publicar.
Os modelos locais de App Hosting/Cloud Run e os limites da beta estão descritos
em `docs/test-safety.md`. Eles não habilitam faturamento nem fazem deploy.
