import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, loadConfig } from './config';
import { PrismaService } from './prisma.service';
import { TokensService } from './auth/tokens.service';
import { StaffGuard, PatientGuard } from './auth/guards';
import { StaffAuthController } from './auth/staff-auth.controller';
import { PatientAuthController } from './patient/patient-auth.controller';
import { PatientAppointmentsController } from './patient/patient-appointments.controller';
import { ClinicController } from './clinic/clinic.controller';
import { SchedulingController } from './scheduling/scheduling.controller';
import { AppointmentsService } from './appointments/appointments.service';
import { StaffAppointmentsController } from './appointments/staff-appointments.controller';
import { PublicController } from './public/public.controller';
import { HealthController } from './health.controller';
import { AuthTokensService } from './auth/auth-tokens.service';
import { InvitationsController } from './auth/invitations.controller';
import { JobsService } from './jobs/jobs.service';
import { MailService } from './mail/mail.service';
import { MAIL_TRANSPORT, MailTransport, createTransport } from './mail/mail.transport';

export function buildAppModule(config: AppConfig = loadConfig(), mailTransport: MailTransport = createTransport(config.mail)) {
  @Module({
    controllers: [
      HealthController, StaffAuthController, PatientAuthController, PatientAppointmentsController,
      ClinicController, SchedulingController, StaffAppointmentsController, PublicController, InvitationsController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: MAIL_TRANSPORT, useValue: mailTransport },
      PrismaService, TokensService, StaffGuard, PatientGuard, AppointmentsService,
      AuthTokensService, JobsService, MailService,
    ],
  })
  class AppModule {}
  return AppModule;
}
