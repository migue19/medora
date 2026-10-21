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
import { DoctorPhotoController, PublicController, SitemapController } from './public/public.controller';
import { HealthController } from './health.controller';
import { AuthTokensService } from './auth/auth-tokens.service';
import { InvitationsController } from './auth/invitations.controller';
import { JobsService } from './jobs/jobs.service';
import { MailService } from './mail/mail.service';
import { MAIL_TRANSPORT, MailTransport, createTransport } from './mail/mail.transport';
import { AppointmentActionsController } from './appointments/appointment-actions.controller';
import { RemindersService } from './notifications/reminders.service';
import { PatientLinksController, PatientsController } from './patients/patients.controller';
import { PatientsService } from './patients/patients.service';
import { PatientWaitlistController, StaffWaitlistController } from './waitlist/waitlist.controller';
import { WaitlistService } from './waitlist/waitlist.service';
import { LocationsController } from './locations/locations.controller';
import { PatientReviewsController, PublicReviewsController, StaffReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { WHATSAPP_TRANSPORT, WhatsAppTransport, createWhatsApp } from './notifications/whatsapp.transport';

export interface Transports {
  mail?: MailTransport;
  whatsapp?: WhatsAppTransport;
}

export function buildAppModule(config: AppConfig = loadConfig(), transports: Transports = {}) {
  @Module({
    controllers: [
      HealthController, StaffAuthController, PatientAuthController, PatientAppointmentsController,
      ClinicController, SchedulingController, StaffAppointmentsController, PublicController, InvitationsController,
      AppointmentActionsController, PatientsController, PatientLinksController, StaffWaitlistController,
      PatientWaitlistController, LocationsController, DoctorPhotoController, SitemapController,
      PublicReviewsController, PatientReviewsController, StaffReviewsController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: MAIL_TRANSPORT, useValue: transports.mail ?? createTransport(config.mail) },
      { provide: WHATSAPP_TRANSPORT, useValue: transports.whatsapp ?? createWhatsApp(config.whatsapp) },
      PrismaService, TokensService, StaffGuard, PatientGuard, AppointmentsService,
      AuthTokensService, JobsService, MailService, RemindersService, PatientsService, WaitlistService, ReviewsService,
    ],
  })
  class AppModule {}
  return AppModule;
}
