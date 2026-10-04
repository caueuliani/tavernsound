import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TestSafetyService } from './test-safety.service';
import { TestSafetyGuard } from './test-safety.guard';

@Global()
@Module({
  providers: [TestSafetyService, { provide: APP_GUARD, useClass: TestSafetyGuard }],
  exports: [TestSafetyService],
})
export class TestSafetyModule {}
