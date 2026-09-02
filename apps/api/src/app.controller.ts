import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): object {
    return {
      message: '🎮 VTT API rodando com sucesso!',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  healthCheck(): object {
    return {
      status: 'healthy',
      uptime: process.uptime(),
    };
  }
}