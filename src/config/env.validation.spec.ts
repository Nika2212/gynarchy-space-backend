import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    JWT_SECRET: 'secret',
    APP_PASSCODE: '0000',
    XMD: 'https://example.com',
    CORS_ORIGIN: 'http://localhost:4200',
  };

  it('returns config when required keys are present', () => {
    expect(validateEnv(valid)).toEqual(valid);
  });

  it('throws when a required key is missing or blank', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: '' })).toThrow('JWT_SECRET is required');
    expect(() => validateEnv({ ...valid, APP_PASSCODE: '   ' })).toThrow('APP_PASSCODE is required');
    expect(() => validateEnv({ JWT_SECRET: 'x', APP_PASSCODE: 'y', CORS_ORIGIN: 'http://localhost:4200' })).toThrow(
      'XMD is required',
    );
    expect(() => validateEnv({ ...valid, CORS_ORIGIN: '' })).toThrow('CORS_ORIGIN is required');
  });
});
