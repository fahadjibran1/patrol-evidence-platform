import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CryptoModule } from '@/crypto/crypto.module';
import { CustomerDownloadsService } from './customer-downloads.service';

@Module({
  imports: [CustomerAuthModule, CryptoModule],
  providers: [CustomerDownloadsService],
  exports: [CustomerDownloadsService],
})
export class CustomerDownloadsModule {}
