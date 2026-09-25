import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    JWT_SECRET: 'secret',
    APP_PASSCODE: '0000',
    XMD: 'https://example.com',
    CORS_ORIGIN: 'http://localhost:4200',
    MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/gynarchy',
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
    expect(() => validateEnv({ ...valid, MONGODB_URI: '' })).toThrow('MONGODB_URI is required');
  });

  it('throws when MONGODB_URI is not a Mongo URL', () => {
    expect(() => validateEnv({ ...valid, MONGODB_URI: 'https://example.com' })).toThrow(
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// URL',
    );
  });

  it('accepts a mongodb:// URI', () => {
    expect(validateEnv({ ...valid, MONGODB_URI: 'mongodb://localhost:27017/gynarchy' })).toEqual({
      ...valid,
      MONGODB_URI: 'mongodb://localhost:27017/gynarchy',
    });
  });

  it('throws when CORS_ORIGIN is only separators', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGIN: ' , ' })).toThrow('CORS_ORIGIN is required');
  });

  it('throws when CORS_ORIGIN contains an invalid origin', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGIN: 'http://ok.example,not-a-url' })).toThrow(
      'CORS_ORIGIN contains an invalid origin: not-a-url',
    );
  });
});
