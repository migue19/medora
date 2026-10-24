import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PushService } from './push.service';

class KeysDto {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(100) auth: string;
}

class SubscribeDto {
  @IsString() @MaxLength(1000) @Matches(/^https:\/\//) endpoint: string;
  @ValidateNested() @Type(() => KeysDto) keys: KeysDto;
}

class UnsubscribeDto {
  @IsString() @MaxLength(1000) endpoint: string;
}

@Controller('api/clinic/push')
@UseGuards(StaffGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key')
  key() {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscribe')
  @HttpCode(204)
  async subscribe(@Staff() s: StaffContext, @Body() dto: SubscribeDto) {
    await this.push.subscribe(s.userId, s.membershipId, { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth });
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(@Staff() s: StaffContext, @Body() dto: UnsubscribeDto) {
    await this.push.unsubscribe(s.userId, dto.endpoint);
  }

  @Post('test')
  @HttpCode(204)
  async test(@Staff() s: StaffContext) {
    await this.push.notify([s.membershipId], { title: 'Tepahti', body: 'Las notificaciones de este dispositivo funcionan.', url: '/panel', tag: 'prueba' }, `test:${s.membershipId}:${Date.now()}`);
  }
}
