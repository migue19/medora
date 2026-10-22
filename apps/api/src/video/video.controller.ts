import {
  Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { assertOrigin, clientIp } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { Patient, PatientContext, PatientGuard, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { VideoService } from './video.service';

class ConsentDto {
  @IsOptional() @IsBoolean() consent?: boolean;
}

class LinkDto extends ConsentDto {
  @IsString() @Length(54, 54) token: string;
}

/** La sala de espera manda una señal cada ~20 s: límite propio, holgado. */
const videoLimiter = new RateLimiter(240, 15 * 60_000);

/** Entrada desde el enlace del correo (pacientes sin cuenta o desde otro dispositivo). */
@Controller('api/video/link')
export class VideoLinkController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly video: VideoService) {}

  private async find(req: Request, token: string) {
    assertOrigin(req, this.config);
    videoLimiter.consume(`video:${clientIp(req)}`);
    const id = this.video.appointmentIdFromLink(token);
    const a = id ? await this.video.load(id) : null;
    if (!a || a.modality !== 'VIDEO') throw new NotFoundException('El enlace de la videoconsulta no es válido');
    return a;
  }

  @Post('info')
  @HttpCode(200)
  async info(@Body() dto: LinkDto, @Req() req: Request) {
    return this.video.info(await this.find(req, dto.token));
  }

  @Post('join')
  @HttpCode(200)
  async join(@Body() dto: LinkDto, @Req() req: Request) {
    return this.video.patientJoin(await this.find(req, dto.token), dto.consent ?? false);
  }

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Body() dto: LinkDto, @Req() req: Request) {
    return this.video.heartbeat(await this.find(req, dto.token));
  }
}

/** Entrada desde «Mis citas». */
@Controller('api/patient/appointments')
@UseGuards(PatientGuard)
export class PatientVideoController {
  constructor(private readonly video: VideoService) {}

  private async own(patient: PatientContext, id: string) {
    const a = await this.video.load(id);
    if (!a || a.clinicPatient.patientAccountId !== patient.id || a.modality !== 'VIDEO') throw new NotFoundException('Videoconsulta no encontrada');
    return a;
  }

  @Get(':id/video')
  async info(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.video.info(await this.own(patient, id));
  }

  @Post(':id/video/join')
  @HttpCode(200)
  async join(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsentDto) {
    return this.video.patientJoin(await this.own(patient, id), dto.consent ?? false);
  }

  @Post(':id/video/heartbeat')
  @HttpCode(200)
  async heartbeat(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.video.heartbeat(await this.own(patient, id));
  }
}

/** El médico de la cita (o propietario/administración) abre la sala como anfitrión. */
@Controller('api/clinic/appointments')
@UseGuards(StaffGuard)
export class StaffVideoController {
  constructor(private readonly video: VideoService) {}

  private async visible(staff: StaffContext, id: string) {
    const a = await this.video.load(id);
    if (!a || a.clinicId !== staff.clinicId || a.modality !== 'VIDEO') throw new NotFoundException('Videoconsulta no encontrada');
    if (staff.role === 'RECEPTION') throw new ForbiddenException('Sólo el médico de la cita atiende la videoconsulta');
    if (staff.role === 'DOCTOR' && staff.doctorId !== a.doctorId) throw new ForbiddenException('Esta videoconsulta es de otro médico');
    return a;
  }

  @Get(':id/video')
  async info(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.visible(staff, id);
    return { ...this.video.info(a), patientWaiting: VideoService.waiting(a) };
  }

  @Post(':id/video/join')
  @HttpCode(200)
  async join(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.visible(staff, id);
    return this.video.doctorJoin(a, staff.role === 'DOCTOR' ? a.doctor.displayName : staff.name);
  }
}
