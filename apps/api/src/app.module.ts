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

export function buildAppModule(config: AppConfig = loadConfig()) {
  @Module({
    controllers: [
      HealthController, StaffAuthController, PatientAuthController, PatientAppointmentsController,
      ClinicController, SchedulingController, StaffAppointmentsController, PublicController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      PrismaService, TokensService, StaffGuard, PatientGuard, AppointmentsService,
    ],
  })
  class AppModule {}
  return AppModule;
}
