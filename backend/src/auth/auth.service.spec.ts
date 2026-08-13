import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hashPassword } from '../common/crypto/password';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload';

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ISSUER = 'postman-clone';
const AUDIENCE = 'postman-clone-api';

const PASSWORD = 'Password123!';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let usersRepository: { findOne: jest.Mock };
  let sessionsService: { create: jest.Mock };
  let user: UserEntity;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'seed@example.com',
      passwordHash: await hashPassword(PASSWORD),
    } as UserEntity;

    usersRepository = { findOne: jest.fn().mockResolvedValue(user) };
    sessionsService = {
      create: jest.fn().mockResolvedValue({
        session: { id: 'session-1' },
        refreshToken: 'refresh-token',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      // The real JwtModule, mirroring auth.module.ts, so these tests assert the
      // token an actual client would receive rather than a stub's return value.
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: '15m',
            issuer: ISSUER,
            audience: AUDIENCE,
          },
        }),
      ],
      providers: [
        AuthService,
        { provide: SessionsService, useValue: sessionsService },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: usersRepository as unknown as Repository<UserEntity>,
        },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createToken', () => {
    it('signs a verifiable token carrying the user and session', () => {
      const token = service.createToken('user-1', 'session-1');

      const payload = jwtService.verify<JwtPayload>(token, {
        secret: TEST_SECRET,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      expect(payload.sub).toBe('user-1');
      expect(payload.sid).toBe('session-1');
      expect(payload.jti).toEqual(expect.any(String));
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('uses HS256 and never "none"', () => {
      const [encodedHeader] = service.createToken('u', 's').split('.');
      const header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as { alg: string };

      expect(header.alg).toBe('HS256');
    });

    it('gives every token a distinct jti', () => {
      const decode = (token: string) =>
        jwtService.decode<JwtPayload>(token).jti;

      expect(decode(service.createToken('u', 's'))).not.toBe(
        decode(service.createToken('u', 's')),
      );
    });

    it('keeps sensitive and mutable user fields out of the payload', () => {
      const payload = jwtService.decode<JwtPayload & Record<string, unknown>>(
        service.createToken('user-1', 'session-1'),
      );

      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('passwordHash');
      expect(payload).not.toHaveProperty('name');
    });

    it('rejects a token whose payload was tampered with', () => {
      const [header, , signature] = service
        .createToken('user-1', 'session-1')
        .split('.');
      const forged = Buffer.from(
        JSON.stringify({ sub: 'admin', sid: 'session-1', jti: 'x' }),
      ).toString('base64url');

      expect(() =>
        jwtService.verify(`${header}.${forged}.${signature}`, {
          secret: TEST_SECRET,
        }),
      ).toThrow();
    });
  });

  describe('login', () => {
    it('returns both tokens for correct credentials', async () => {
      const result = await service.login(user.email, PASSWORD);

      expect(result.refreshToken).toBe('refresh-token');
      expect(jwtService.decode<JwtPayload>(result.accessToken).sub).toBe(
        'user-1',
      );
      expect(sessionsService.create).toHaveBeenCalledWith('user-1');
    });

    it('rejects a wrong password without creating a session', async () => {
      await expect(service.login(user.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown email with the same message as a wrong password', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', PASSWORD),
      ).rejects.toThrow('Invalid credentials');
      expect(sessionsService.create).not.toHaveBeenCalled();
    });
  });
});
