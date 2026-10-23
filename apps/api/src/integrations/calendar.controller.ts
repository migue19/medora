import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsBoolean, IsOptional, IsUUID, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { DateTime } from 'luxon';
import { Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PrismaService } from '../prisma.service';
import { CalendarService } from './calendar.service';

class PushDto {
  @IsBoolean() pushAppointments: boolean;
}

class BusyDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) days?: number;
  @IsOptional() @IsUUID() doctorId?: string;
}

/** El médico conecta su calendario desde «Mi cuenta». */
@Controller('api/clinic/calendar')
@UseGuards(StaffGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService, private readonly prisma: PrismaService) {}

  @Get()
  status(@Staff() s: StaffContext) {
    return this.calendar.status(s);
  }

  @Get('busy')
  async busy(@Staff() s: StaffContext, @Query() q: BusyDto) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: s.clinicId } });
    const from = DateTime.fromISO(q.from, { zone: clinic.timezone }).startOf('day');
    // Recepción ve los bloques ocupados (sólo horario), no los detalles del evento.
    const doctorId = s.role === 'DOCTOR' ? s.doctorId ?? undefined : q.doctorId;
    return this.calendar.busy(s.clinicId, from.toJSDate(), from.plus({ days: q.days ?? 1 }).toJSDate(), doctorId);
  }

  @Post(':provider/start')
  @HttpCode(200)
  start(@Staff() s: StaffContext, @Param('provider') provider: string) {
    return this.calendar.start(s, this.calendar.parseKind(provider));
  }

  @Patch(':provider')
  @HttpCode(204)
  push(@Staff() s: StaffContext, @Param('provider') provider: string, @Body() dto: PushDto) {
    return this.calendar.setPush(s, this.calendar.parseKind(provider), dto.pushAppointments);
  }

  @Delete(':provider')
  @HttpCode(204)
  disconnect(@Staff() s: StaffContext, @Param('provider') provider: string) {
    return this.calendar.disconnect(s, this.calendar.parseKind(provider));
  }
}

/** Rutas que llaman Google y Microsoft: regreso de OAuth y notificaciones de cambios. */
@Controller('api/integrations')
export class CalendarHooksController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string, @Query('code') code: string | undefined, @Query('state') state: string | undefined,
    @Query('error') error: string | undefined, @Res() res: Response,
  ) {
    res.redirect(302, await this.calendar.callback(provider, code, state, error));
  }

  @Post('google/notify')
  @HttpCode(200)
  async google(@Headers('x-goog-channel-id') channelId?: string, @Headers('x-goog-channel-token') token?: string) {
    await this.calendar.notify('google', channelId, token);
    return '';
  }

  /** Microsoft valida la suscripción devolviendo el token en texto plano; después manda los avisos en lotes. */
  @Post('microsoft/notify')
  async microsoft(@Query('validationToken') validation: string | undefined, @Req() req: Request, @Res() res: Response) {
    if (validation) {
      res.status(200).type('text/plain').send(validation.slice(0, 1024));
      return;
    }
    const items = ((req.body as { value?: { subscriptionId?: string; clientState?: string }[] })?.value ?? []).slice(0, 100);
    for (const n of items) await this.calendar.notify('microsoft', n.subscriptionId, n.clientState);
    res.status(202).send();
  }
}
