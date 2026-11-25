import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CategoryDto } from '@parakh/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CategoryDto[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.examCategory.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.exam.groupBy({
        by: ['catalogCategory'],
        where: { alwaysOpen: true },
        _count: { _all: true },
      }),
    ]);
    const used = new Map(counts.map((c) => [c.catalogCategory, c._count._all]));
    return rows.map((r) => ({ id: r.id, name: r.name, examCount: used.get(r.name) ?? 0 }));
  }

  private async assertFree(name: string, exceptId?: string) {
    const clash = await this.prisma.examCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw new ConflictException('A category with this name already exists');
  }

  async create(name: string): Promise<CategoryDto> {
    await this.assertFree(name);
    const row = await this.prisma.examCategory.create({ data: { name } });
    return { id: row.id, name: row.name, examCount: 0 };
  }

  /** Renaming also moves the exams filed under the old name. */
  async rename(id: string, name: string): Promise<CategoryDto> {
    const row = await this.prisma.examCategory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Category not found');
    await this.assertFree(name, id);
    await this.prisma.$transaction([
      this.prisma.examCategory.update({ where: { id }, data: { name } }),
      this.prisma.exam.updateMany({
        where: { catalogCategory: row.name },
        data: { catalogCategory: name },
      }),
    ]);
    const examCount = await this.prisma.exam.count({
      where: { catalogCategory: name, alwaysOpen: true },
    });
    return { id, name, examCount };
  }

  async remove(id: string): Promise<{ id: string; name: string }> {
    const row = await this.prisma.examCategory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Category not found');
    const inUse = await this.prisma.exam.count({ where: { catalogCategory: row.name } });
    if (inUse > 0) {
      throw new BadRequestException(
        `${inUse} exam${inUse === 1 ? ' is' : 's are'} filed under this category. Move them to another category first.`,
      );
    }
    await this.prisma.examCategory.delete({ where: { id } });
    return { id, name: row.name };
  }

  /** The exact stored name for a category the admin picked, or a validation error. */
  async resolve(name: string): Promise<string> {
    const row = await this.prisma.examCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (!row) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: { catalogCategory: ['Choose a category from the list'] },
      });
    }
    return row.name;
  }
}
