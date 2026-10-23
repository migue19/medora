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
import { VIDEO_PROVIDER, VideoProvider, createVideo } from './video/video.provider';
import { VideoService } from './video/video.service';
import { RecordsService } from './records/records.service';
import { BillingService } from './billing/billing.service';
import { ReportsService } from './reports/reports.service';
import { IntegrationsService } from './integrations/integrations.service';
import { CalendarService } from './integrations/calendar.service';
import { PUSH_TRANSPORT, PushService, PushTransport, WebPushTransport } from './integrations/push.service';
import { PushController } from './integrations/push.controller';
import { CalendarController, CalendarHooksController } from './integrations/calendar.controller';
import { CALENDAR_PROVIDERS, CalendarProviders, GoogleCalendar, MicrosoftCalendar } from './integrations/calendar.providers';
import { ApiKeyGuard, ApiV1Controller, IntegrationsController } from './integrations/api-v1.controller';
import { HttpWebhookTransport, WEBHOOK_TRANSPORT, WebhookTransport } from './integrations/webhook.transport';
import { WeeklyReportService } from './reports/weekly.service';
import { ReportsController } from './reports/reports.controller';
import { SignupService } from './billing/signup.service';
import { AdminController, SignupController, SubscriptionController } from './billing/billing.controller';
import { BILLING_GATEWAY, BillingGateway, createBilling } from './billing/billing.gateway';
import { CFDI_PROVIDER, CfdiProvider, createCfdi } from './billing/cfdi';
import { PrescriptionVerifyController, RecordsController } from './records/records.controller';
import { PatientVideoController, StaffVideoController, VideoLinkController } from './video/video.controller';
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
  video?: VideoProvider;
  billing?: BillingGateway;
  cfdi?: CfdiProvider;
  webhooks?: WebhookTransport;
  calendars?: CalendarProviders;
  push?: PushTransport;
}

export function buildAppModule(config: AppConfig = loadConfig(), transports: Transports = {}) {
  @Module({
    controllers: [
      HealthController, StaffAuthController, PatientAuthController, PatientAppointmentsController,
      ClinicController, SchedulingController, StaffAppointmentsController, PublicController, InvitationsController,
      AppointmentActionsController, PatientsController, PatientLinksController, StaffWaitlistController,
      PatientWaitlistController, LocationsController, DoctorPhotoController, SitemapController, DirectoryController,
      PatientPaymentsController, PaymentWebhookController, ClinicPaymentsController,
      VideoLinkController, PatientVideoController, StaffVideoController, RecordsController, PrescriptionVerifyController,
      SignupController, SubscriptionController, AdminController, ReportsController,
      ApiV1Controller, IntegrationsController, CalendarController, CalendarHooksController, PushController,
      PublicReviewsController, PatientReviewsController, StaffReviewsController, OnboardingController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: MAIL_TRANSPORT, useValue: transports.mail ?? createTransport(config.mail) },
      { provide: WHATSAPP_TRANSPORT, useValue: transports.whatsapp ?? createWhatsApp(config.whatsapp) },
      { provide: PAYMENT_GATEWAY, useValue: transports.payments ?? createGateway(config.payments) },
      { provide: VIDEO_PROVIDER, useValue: transports.video ?? createVideo(config.video) },
      { provide: BILLING_GATEWAY, useValue: transports.billing ?? createBilling(config.payments) },
      { provide: CFDI_PROVIDER, useValue: transports.cfdi ?? createCfdi(config.invoicing) },
      { provide: PUSH_TRANSPORT, useValue: transports.push ?? (config.push ? new WebPushTransport(config.push) : null) },
      { provide: WEBHOOK_TRANSPORT, useValue: transports.webhooks ?? new HttpWebhookTransport() },
      {
        provide: CALENDAR_PROVIDERS,
        useValue: transports.calendars ?? {
          ...(config.calendars.google ? { GOOGLE: new GoogleCalendar(config.calendars.google) } : {}),
          ...(config.calendars.microsoft ? { MICROSOFT: new MicrosoftCalendar(config.calendars.microsoft) } : {}),
        },
      },
      PrismaService, TokensService, StaffGuard, PatientGuard, AppointmentsService,
      AuthTokensService, JobsService, MailService, RemindersService, PatientsService, WaitlistService, ReviewsService, OnboardingService, DirectoryService, PaymentsService, VideoService, RecordsService, BillingService, SignupService, ReportsService, WeeklyReportService, IntegrationsService, ApiKeyGuard, CalendarService, PushService,
    ],
  })
  class AppModule {}
  return AppModule;
}
