import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { categoryInputSchema, type CategoryInput } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { requestMeta } from '../common/request-meta';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CategoriesService } from './categories.service';

/** The fields an always-open exam can be filed under. NandiVex staff only. */
@Roles('ADMIN')
@Controller('admin/categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.categories.list();
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const row = await this.categories.create(body.name);
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.category_created',
      entity: 'ExamCategory',
      entityId: row.id,
      meta: { name: row.name },
      ip: requestMeta(req).ip,
    });
    return row;
  }

  @Patch(':id')
  async rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(categoryInputSchema)) body: CategoryInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const row = await this.categories.rename(id, body.name);
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.category_renamed',
      entity: 'ExamCategory',
      entityId: id,
      meta: { name: row.name },
      ip: requestMeta(req).ip,
    });
    return row;
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const row = await this.categories.remove(id);
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.category_deleted',
      entity: 'ExamCategory',
      entityId: id,
      meta: { name: row.name },
      ip: requestMeta(req).ip,
    });
    return row;
  }
}
