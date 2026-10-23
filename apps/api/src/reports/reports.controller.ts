import { Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { NotFoundException } from '@nestjs/common';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PrismaService } from '../prisma.service';
import { assertFeature } from '../billing/plans';
import { ReportsService } from './reports.service';
import { WeeklyReportService } from './weekly.service';
import { csv, xlsx } from './xlsx';

class RangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsUUID() locationId?: string;
}

@Controller('api/clinic/reports')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService, private readonly weekly: WeeklyReportService, private readonly prisma: PrismaService,
  ) {}

  @Get('summary')
  summary(@Staff() s: StaffContext, @Query() q: RangeDto) {
    return this.reports.summary(s.clinicId, q);
  }

  @Get('export/:format')
  async export(@Staff() s: StaffContext, @Param('format') format: string, @Query() q: RangeDto, @Res() res: Response) {
    if (format !== 'csv' && format !== 'xlsx') throw new NotFoundException();
    assertFeature(await this.prisma.clinic.findUniqueOrThrow({ where: { id: s.clinicId } }), 'exports');
    const rows = await this.reports.exportRows(s.clinicId, q);
    const name = `citas-${q.from}-a-${q.to}.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(format === 'csv' ? csv(rows) : xlsx('Citas', rows));
  }

  /** Manda ahora el resumen de la semana pasada a quien lo pide (para verlo antes del lunes). */
  @Post('weekly-preview')
  @HttpCode(200)
  async preview(@Staff() s: StaffContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    await this.weekly.sendClinic(s.clinicId, new Date(), user.email);
    return { sentTo: user.email };
  }
}
