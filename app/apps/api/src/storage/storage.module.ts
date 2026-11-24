import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { STORAGE, createStorage } from './storage.service';

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: (env: Env) => createStorage(env) }],
  exports: [STORAGE],
})
export class StorageModule {}
