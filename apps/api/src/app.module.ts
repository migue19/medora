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
import { DirectoryController } from './directory/directory.controller';
import { DirectoryService } from './directory/directory.service';
import { PaymentsService } from './payments/payments.service';
import { ClinicPaymentsController, PatientPaymentsController, PaymentWebhookController } from './payments/payments.controller';
import { PAYMENT_GATEWAY, PaymentGateway, createGateway } from './payments/gateway';
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
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { WHATSAPP_TRANSPORT, WhatsAppTransport, createWhatsApp } from './notifications/whatsapp.transport';

export interface Transports {
  mail?: MailTransport;
  whatsapp?: WhatsAppTransport;
  payments?: PaymentGateway;
}

export function buildAppModule(config: AppConfig = loadConfig(), transports: Transports = {}) {
  @Module({
    controllers: [
      HealthController, StaffAuthController, PatientAuthController, PatientAppointmentsController,
      ClinicController, SchedulingController, StaffAppointmentsController, PublicController, InvitationsController,
      AppointmentActionsController, PatientsController, PatientLinksController, StaffWaitlistController,
      PatientWaitlistController, LocationsController, DoctorPhotoController, SitemapController, DirectoryController,
      PatientPaymentsController, PaymentWebhookController, ClinicPaymentsController,
      PublicReviewsController, PatientReviewsController, StaffReviewsController, OnboardingController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: MAIL_TRANSPORT, useValue: transports.mail ?? createTransport(config.mail) },
      { provide: WHATSAPP_TRANSPORT, useValue: transports.whatsapp ?? createWhatsApp(config.whatsapp) },
      { provide: PAYMENT_GATEWAY, useValue: transports.payments ?? createGateway(config.payments) },
      PrismaService, TokensService, StaffGuard, PatientGuard, AppointmentsService,
      AuthTokensService, JobsService, MailService, RemindersService, PatientsService, WaitlistService, ReviewsService, OnboardingService, DirectoryService, PaymentsService,
    ],
  })
  class AppModule {}
  return AppModule;
}
