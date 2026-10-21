import {
  BadRequestException, Body, Controller, HttpCode, Inject, Post, Put, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { IsObject, IsString, Length, Matches } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { assertOrigin, clientIp } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { MAX_PHOTO_BYTES } from '../scheduling/scheduling.controller';
import { OnboardingService } from './onboarding.service';

class TokenDto {
  @IsString() @Length(20, 200) token: string;
}

class SaveDto extends TokenDto {
  @IsObject() data: Record<string, unknown>;
}

class PhotoDto extends TokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) doctorKey: string;
}

const PHOTO_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** El formulario se guarda solo mientras escriben: límite propio, más amplio que el de los enlaces de un solo uso. */
const onboardingLimiter = new RateLimiter(400, 15 * 60_000);

/** Formulario público de alta. El token (en el fragmento del enlace) va siempre en el cuerpo, nunca en la URL. */
@Controller('api/public/onboarding')
export class OnboardingController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly onboarding: OnboardingService) {}

  private guard(req: Request) {
    assertOrigin(req, this.config);
    onboardingLimiter.consume(`onboarding:${clientIp(req)}`);
  }

  @Post('load')
  @HttpCode(200)
  async load(@Body() dto: TokenDto, @Req() req: Request) {
    this.guard(req);
    return this.onboarding.load(dto.token);
  }

  @Put('save')
  async save(@Body() dto: SaveDto, @Req() req: Request) {
    this.guard(req);
    return this.onboarding.save(dto.token, dto.data);
  }

  @Post('submit')
  @HttpCode(200)
  async submit(@Body() dto: TokenDto, @Req() req: Request) {
    this.guard(req);
    return this.onboarding.submit(dto.token);
  }

  @Post('photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async uploadPhoto(
    @Body() dto: PhotoDto, @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    this.guard(req);
    if (!file?.buffer?.length) throw new BadRequestException('Falta la imagen');
    const type = Object.keys(PHOTO_TYPES).find((t) => PHOTO_TYPES[t](file.buffer));
    if (!type) throw new BadRequestException('La foto debe ser JPEG, PNG o WebP');
    return this.onboarding.savePhoto(dto.token, dto.doctorKey, type, file.buffer);
  }

  @Post('photo/view')
  @HttpCode(200)
  async viewPhoto(@Body() dto: PhotoDto, @Req() req: Request, @Res() res: Response) {
    this.guard(req);
    const p = await this.onboarding.photo(dto.token, dto.doctorKey);
    res.setHeader('Content-Type', p.mimeType);
    res.send(Buffer.from(p.data));
  }

  @Post('photo/delete')
  @HttpCode(204)
  async deletePhoto(@Body() dto: PhotoDto, @Req() req: Request) {
    this.guard(req);
    await this.onboarding.deletePhoto(dto.token, dto.doctorKey);
  }
}
