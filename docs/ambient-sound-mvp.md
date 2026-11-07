# Som ambiente — MVP compartilhado

## Biblioteca procedural

O mestre escolhe o som para a sala. Opções:
- 🌧️ Chuva
- 🍃 Vento
- 🔥 Fogueira
- 🏖️ Praia e ondas do mar
- 🍺 Taverna
- 🌲 Floresta
- 🕯️ Masmorra
- ⚔️ Combate
- 🔇 Silêncio

Cada preset utiliza **síntese local Web Audio**: ruído filtrado, modulação de
intensidade e alguns acentos tonais. Não há música, streaming, arquivos de
terceiros ou downloads de áudio. Sons como gaivotas, tavernas cheias e batalhas
são **representações sintéticas simplificadas**, não gravações realistas.

## Funcionamento

- O mestre seleciona um preset para todos os participantes via Socket.IO.
- O jogador recebe o preset da sala, mas o áudio somente começa quando
  ele clica em **Ouvir ambiente** (respeita o bloqueio de autoplay).
- Cada jogador tem seu volume independente e pode silenciar o ambiente.
- A alteração de ambiente atualiza os clientes já conectados.
- Quem chega depois recebe o preset da sala no snapshot de entrada.
- Os presets não exigem publicação de faixa no Agora e não consomem
  participante-minutos do serviço de voz.
- O ambiente atual é **mantido somente em memória na API**: um restart do
  servidor o redefine para Silêncio. Persistência por campanha/cena será
  trabalho futuro, depois da migração de múltiplas cenas.

## Homologação com dois navegadores

1. Mestre ativa **Praia e ondas do mar**.
2. Jogador recebe a seleção e clica em **Ouvir ambiente**.
3. Mestre troca para **Floresta**; jogador passa a ouvir o novo ambiente.
4. Jogador baixa o volume a 0% e depois recupera: o mestre não perde seu som.
5. Jogador atualiza a página: a seleção permanece se a API não reiniciou;
   reprodução exige um novo clique.
6. Jogador tenta emitir `set-ambient-preset` diretamente: o backend rejeita
   alteração de não-mestre.
7. Testar navegadores desktop e mobile, além de voz simultânea com Agora.

Não considerar concluída a UX sem escutar os presets no dispositivo real.
