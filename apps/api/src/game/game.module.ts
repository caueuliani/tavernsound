import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { RoomAccessService } from './room-access.service';
import { RoomsController } from './rooms.controller';
import { SceneController } from './scene.controller';
import { TokenImageController } from './token-image.controller';
import { SceneryTokenController } from './scenery-token.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CharactersController } from './characters.controller';
import { CharactersService } from './characters.service';

@Module({
  providers: [GameGateway, RoomAccessService, CampaignsService, CharactersService],
  controllers: [GameController, RoomsController, SceneController, TokenImageController, SceneryTokenController, CampaignsController, CharactersController],
})
export class GameModule {}
