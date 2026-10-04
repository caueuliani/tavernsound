import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('reports API availability with a timestamp', () => {
      expect(appController.getHello()).toEqual({
        message: '🎮 VTT API rodando com sucesso!',
        status: 'ok',
        timestamp: expect.any(String),
      });
    });
  });
});
