import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { RoomAccessService } from './room-access.service';
import { RoomsController } from './rooms.controller';
import { SceneController } from './scene.controller';
import { TokenImageController } from './token-image.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  providers: [GameGateway, RoomAccessService, CampaignsService],
  controllers: [GameController, RoomsController, SceneController, TokenImageController, CampaignsController],
})
export class GameModule {}
