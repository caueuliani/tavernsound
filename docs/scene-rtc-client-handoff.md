# PR #31 — handoff de mídia Agora por cena (cliente, ativação controlada)

## Objetivo
Preparar a troca de canais de áudio e webcam entre cenas **sem ativar teleporte**. O hook atual `useSpatialAudio` passa a receber `sceneId` opcional. Sem ele, continua usando o canal legado da sala e o fluxo da mesa existente permanece inalterado.

## Fluxo de conexão no modo por cena
1. O servidor comunica a cena ativa no evento autenticado `room-joined`.
2. Se `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`, o cliente solicita `GET /agora/token?channelName=<room>&sceneId=<activeSceneId>`; por padrão essa flag fica **desligada**.
3. O cliente valida que as credenciais contêm token, UID e nome de canal compatível com a sala/cena.
4. Ao alterar `sceneId`, fecha imediatamente a captura de microfone **e câmera**, limpa trilhas remotas, nós espaciais e identidade Agora.
5. Aguarda `leave()` do canal anterior antes de iniciar `join()` no novo canal.
6. Usa o nome do canal assinado/autorizado pelo servidor, não um nome construído pelo navegador.
7. O token renovado só é aplicado se continuar pertencendo ao **mesmo canal**; caso contrário a conexão falha fechada.
8. Webcam não é reativada automaticamente ao trocar de cena. O usuário deve autorizá-la novamente.

## Testes
`node --experimental-strip-types --test apps/web/app/lib/scene-rtc.test.ts`

CI executa testes das credenciais de canal, recusa de canal compartilhado em sessão por cena, fechamento de câmera/microfone e ordenação do leave-before-join. Builds API/web e regressões continuam no pipeline.

## Limites desta PR
- **Não existe comando de teleporte, nem alterações em `activeSceneId`.**
- O modo por cena é opt-in para homologação controlada. Não ligue a flag no beta público até ter um plano para garantir que todos os participantes usem o mesmo protocolo; versões antigas usam o canal legado.
- O bloqueio de entrada na mesa para jogadores fora da Cena inicial permanece ativo.
- Ainda falta um protocolo transacional de ativação com ACK/rollback e reentrada no mapa, eventos de presença e mídia.
- Uma credencial Agora antiga pode continuar utilizável até expirar: o corte de mídia não equivale a revogação imediata no serviço Agora. É necessário testar em dois navegadores/dispositivos.

Sem nova migration no Neon.
