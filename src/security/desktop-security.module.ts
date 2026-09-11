import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { DesktopApiGuard } from './desktop-api.guard';
import { DesktopInitializedMutationGuard } from './desktop-initialized-mutation.guard';
import { DesktopRecoveryService } from './desktop-recovery.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [DesktopApiGuard, DesktopInitializedMutationGuard, DesktopRecoveryService],
  exports: [DesktopApiGuard, DesktopInitializedMutationGuard, DesktopRecoveryService],
})
export class DesktopSecurityModule {}
