import { PasscodeDTO } from './passcode.DTO';

describe('PasscodeDTO', () => {
  it('holds a passcode field', () => {
    const dto = new PasscodeDTO();
    dto.passcode = '0000';
    expect(dto.passcode).toBe('0000');
  });
});
