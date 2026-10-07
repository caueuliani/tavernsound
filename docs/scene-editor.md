# Editor de cenários local

Abra a sala e clique em **Preparar cenário sem entrar no áudio**. Para a sala de teste atual: `http://localhost:8080/room/L4U1XW/scene`.

A preparação exige uma conta autorizada na sala, mas não inicia voz nem reserva a janela diária de áudio. Somente o dono da sala pode editar. As ações HTTP continuam sujeitas aos limites gerais da beta.

## Mapa e exemplos

Escolha Taverna, Masmorra ou Caverna no painel para usar um SVG de exemplo. O aplicativo converte esses arquivos conhecidos em imagem antes de enviar. As ilustrações não criam paredes acústicas automaticamente: desenhe os segmentos conforme o mapa.

Também é possível importar PNG, JPG ou WebP estático de até 3 MB e 16 megapixels. O servidor valida o conteúdo, remove metadados ao converter para WebP e reduz a imagem para no máximo 2048 pixels de lado. Uploads de SVG fornecidos pelo usuário não são aceitos.

Importar, trocar ou remover uma imagem salva imediatamente. Antes de trocar o mapa, salve ou desfaça ajustes pendentes. Escala, deslocamentos X/Y e opacidade da grade ficam em prévia até clicar em **Salvar cenário**. Os deslocamentos são em pixels; o tabuleiro atual mantém 10 × 10 células de 50 pixels.

## Paredes, portas e cavernas

- **Jogar:** permite criar/mover tokens na mesa. Na preparação, apenas visualiza o cenário.
- **Parede:** clique em duas extremidades para criar um segmento.
- **Porta:** desenhe um segmento no vão de uma parede. Não sobreponha uma porta a uma parede contínua, pois a parede continuará bloqueando o som.
- **Caverna:** clique em sequência para formar contornos irregulares; **Finalizar linha** encerra o contorno.
- **Selecionar / mover:** clique perto de um segmento; arraste-o para reposicionar. Os botões permitem apagar o segmento ou abrir/fechar a porta selecionada.
- **Encaixar na meia célula:** facilita alinhar pontos à grade. Desative para contornos livres.
- **Desfazer / Refazer:** até 40 ajustes locais. **Salvar cenário** confirma tudo e sincroniza com os jogadores. **Recarregar** recupera o estado salvo, pedindo confirmação se houver alterações locais.

Limite: 200 segmentos por sala. Portas abertas deixam passar o áudio; portas fechadas e paredes alimentam o abafamento espacial existente. Ainda não há colisão de movimento, bloqueio de visão nem reverberação de cavernas.

Se outra conexão salvar primeiro, o servidor rejeita a versão antiga. Recarregue o cenário antes de editar novamente.

## Persistência e hospedagem

Os ajustes e segmentos ficam no campo `Room.sceneData` do PostgreSQL, introduzido pela migração `20260926000000_room_scene`. As imagens ficam em `local-uploads/maps/`, fora do Git, e só são entregues após verificar o acesso à sala. Para backup, preserve o banco e essa pasta.

O inicializador `node work/start-tavernsound.mjs`, executado na pasta pai do repositório, habilita `LOCAL_MAP_UPLOADS=true` apenas no ambiente local. A configuração de exemplo mantém o recurso desligado em outras hospedagens. Para publicar, é necessário definir armazenamento persistente; o disco efêmero de uma hospedagem não garante a conservação dos mapas.

Os SVGs originais estão em `apps/web/public/maps/` e podem ser editados livremente para os testes deste projeto.
