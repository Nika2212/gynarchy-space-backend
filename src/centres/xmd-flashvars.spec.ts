import { parseFlashvarsFromHtml } from './xmd-flashvars';

describe('parseFlashvarsFromHtml', () => {
  it('parses JSON flashvars from a script tag', () => {
    const html = `
      <html><script>
        var flashvars = {"video_id":"12","video_url":"https://cdn.example.com/a.mp4"};
      </script></html>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({
      video_id: '12',
      video_url: 'https://cdn.example.com/a.mp4',
    });
  });

  it('parses unquoted keys and single-quoted values', () => {
    const html = `
      <script>
        var flashvars = {
          video_id: '12',
          license_code: 'abc',
          rnd: 7,
        };
      </script>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({
      video_id: '12',
      license_code: 'abc',
      rnd: 7,
    });
  });

  it('parses window.flashvars assignment', () => {
    const html = `<script>window.flashvars = { video_url: "https://x.test/v.mp4" };</script>`;
    expect(parseFlashvarsFromHtml(html).video_url).toBe('https://x.test/v.mp4');
  });

  it('does not execute expressions inside flashvars', () => {
    const html = `
      <script>
        var flashvars = { video_url: (function(){ throw new Error('executed') })() };
      </script>
    `;

    expect(() => parseFlashvarsFromHtml(html)).toThrow('flashvars not found');
  });

  it('rejects identifier values such as require', () => {
    const html = `<script>var flashvars = { x: require('fs') };</script>`;
    expect(() => parseFlashvarsFromHtml(html)).toThrow('flashvars not found');
  });

  it('throws when flashvars is missing', () => {
    expect(() => parseFlashvarsFromHtml('<html><body></body></html>')).toThrow(
      'flashvars not found',
    );
  });
});
