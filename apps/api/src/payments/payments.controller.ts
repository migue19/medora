import {
  Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Matches } from 'class-validator';
import { DateTime } from 'luxon';
import { Patient, PatientContext, PatientGuard, Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PrismaService } from '../prisma.service';
import { PaymentsService } from './payments.service';

class ReportDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}

/** El paciente abre la página de pago de Stripe para su cita. */
@Controller('api/patient/appointments')
@UseGuards(PatientGuard)
export class PatientPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/checkout')
  @HttpCode(200)
  async checkout(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.checkout(patient.id, id);
  }
}

/** Webhook de Stripe: sin sesión; lo autentica la firma con el secreto del webhook. */
@Controller('api/payments')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('stripe/webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.payments.webhook(req.rawBody, signature);
  }
}

/** Conciliación de pagos para la clínica. */
@Controller('api/clinic/payments')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class ClinicPaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly prisma: PrismaService) {}

  @Get()
  async report(@Staff() staff: StaffContext, @Query() q: ReportDto) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
    const from = DateTime.fromISO(q.from, { zone: clinic.timezone }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: clinic.timezone }).startOf('day').plus({ days: 1 });
    return { timezone: clinic.timezone, available: this.payments.available, ...(await this.payments.report(staff.clinicId, from.toJSDate(), to.toJSDate())) };
  }

  @Post(':id/sync')
  @HttpCode(200)
  async sync(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.resync(staff.clinicId, id);
  }

  @Post(':id/manual-refund')
  @HttpCode(200)
  async manualRefund(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.markRefundedManually(staff.clinicId, id);
  }
}
