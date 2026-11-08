# PR #37 — Troca efetiva de cenário com ACK do cliente e retorno automático

## Fluxo experimental, desligado por padrão

Esta PR conecta a ativação transacional da PR #36 à mesa do navegador **somente** quando habilitados:
- Backend: `SCENE_SCOPED_ADMISSION=true` e `SCENE_LIVE_TRANSFERS=true`.
- Frontend, recompilado com: `NEXT_PUBLIC_SCENE_RTC_HANDOFF=true`.

**Não ligar em produção sem homologação de dois clientes.** A transferência é uma experiência coordenada, mas o ACK do browser não representa uma medição independente da privacidade da mídia no serviço Agora.

1. Mestre define o destino, solicita preflight e jogador confirma.
2. Em um cliente habilitado, o mestre vê **Ativar transferência (experimental)**.
3. A API exige mestre, destino válido, preflight aceito em socket V2 e executa uma transação para mudar `activeSceneId` e `Token.sceneId` juntos.
4. O gateway remove o token antigo do mapa inicial e emite `scene-activation-required` ao destinatário.
5. O navegador recarrega a página (interrompendo Socket.IO, microfone, webcam, nós espaciais e Pixi), volta ao backend e ingressa no grupo Socket.IO da nova cena com token e névoa daquela cena.
6. `useSpatialAudio` pede credenciais assinadas da cena e entra no canal Agora correto.
7. O cliente só emite `scene-client-ready` depois de carregar o snapshot validado, renderizar a imagem do mapa (se houver), e conseguir conectar/publicar seu áudio.
8. O servidor verifica a identidade do socket V2, a sala, a cena ativa persistida e um handoff pendente, antes de concluir o ACK.
9. Se não chegar ACK em **90 segundos**, o servidor tenta uma transação para devolver `activeSceneId` e o token à Cena inicial, notifica o usuário e encerra sua conexão. O mestre pode executar recuperação administrativa mesmo se a rotina automática falhar.
10. Na recuperação, o token persistido é restaurado ao cache do mapa inicial e transmitido aos clientes da cena.

## Restrições e riscos ainda existentes
- O temporizador depende de uma instância API viva; reinício ou múltiplas instâncias sem coordenação distribuída podem perder o handoff pendente.
- O ACK é emitido pelo cliente autenticado depois das condições locais serem cumpridas; um cliente malicioso poderia forjá-lo, então não é prova independente de que a mídia Agora foi realmente encerrada.
- A webcam **não** é reativada automaticamente. A pessoa precisa habilitá-la explicitamente depois de trocar de cena.
- Não há revogação imediata dos tokens RTC já emitidos. Aplicação usa canais diferentes, mas o serviço pode aceitar tokens anteriores até expirar.
- Token em cena alternativa ainda é **somente leitura**: não movimenta, cria ou atualiza HP. Rolagens nessa cena são bloqueadas enquanto não houver histórico por cena.
- Privacidade de canais, falhas de imagem, interrupções de rede, duas abas da mesma conta e retorno da Cena inicial requerem homologação prática.

Nenhuma migration nova. **Não habilitar as flags sem checklist de testes de ponta a ponta.**
