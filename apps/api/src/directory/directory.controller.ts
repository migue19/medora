import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { RateLimiter } from '../common/rate-limit';
import { clientIp } from '../common/http';
import { DirectoryService } from './directory.service';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' || value === true ? true : value === '' ? undefined : value);

class SearchDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Matches(SLUG) @MaxLength(80) especialidad?: string;
  @IsOptional() @Matches(SLUG) @MaxLength(80) padecimiento?: string;
  @IsOptional() @Matches(SLUG) @MaxLength(80) ciudad?: string;
  @IsOptional() @Matches(SLUG) @MaxLength(80) colonia?: string;
  @IsOptional() @IsString() @MaxLength(80) aseguradora?: string;
  /** Precio máximo en centavos. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99999999) precioMax?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() videoconsulta?: boolean;
  @IsOptional() @IsIn(['hoy', 'manana', 'semana']) cuando?: 'hoy' | 'manana' | 'semana';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(100) radioKm?: number;
  @IsOptional() @IsIn(['relevancia', 'disponibilidad', 'precio', 'distancia', 'calificacion'])
  orden?: 'relevancia' | 'disponibilidad' | 'precio' | 'distancia' | 'calificacion';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pagina?: number;
}

class SuggestDto {
  @IsString() @MaxLength(80) q: string;
}

/** Calcular la próxima cita de muchos médicos cuesta: límite propio por IP. */
const directoryLimiter = new RateLimiter(90, 60_000);

@Controller('api/public/directory')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  /** Especialidades y ciudades con médicos en el directorio. */
  @Get()
  async overview(@Req() req: Request) {
    directoryLimiter.consume(`directory:${clientIp(req)}`);
    return this.directory.overview();
  }

  @Get('search')
  async search(@Query() q: SearchDto, @Req() req: Request) {
    directoryLimiter.consume(`directory:${clientIp(req)}`);
    return this.directory.search(q);
  }

  @Get('suggest')
  async suggest(@Query() q: SuggestDto, @Req() req: Request) {
    directoryLimiter.consume(`directory:${clientIp(req)}`);
    return this.directory.suggest(q.q);
  }

  /** Catálogo completo (para el panel: sugerencias de especialidad y padecimientos). */
  @Get('catalog')
  async catalog(@Res({ passthrough: true }) res: Response) {
    const { specialties, conditions } = await this.directory.loadCatalog();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const out = (e: { slug: string; name: string }) => ({ slug: e.slug, name: e.name });
    return { specialties: specialties.map(out), conditions: conditions.map(out) };
  }
}
