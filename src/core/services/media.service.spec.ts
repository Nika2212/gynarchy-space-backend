import { Test, TestingModule } from '@nestjs/testing';
import { PER_PAGE_SIZE, XMDCentre } from '../../centres/XMD.centre';
import type { IMediaInfo } from '../../interfaces/media-info.interface';
import { MediaService } from './media.service';

function mockMedia(overrides: Partial<IMediaInfo> = {}): IMediaInfo {
  return {
    title: 't',
    url: '/watch/x',
    thumbnailSrc: ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg', '/6.jpg'],
    remoteSrc: '',
    description: '',
    postedAt: '',
    duration: 0,
    ...overrides,
  };
}

describe('MediaService', () => {
  let service: MediaService;
  let search: jest.Mock;

  beforeEach(async () => {
    search = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: XMDCentre,
          useValue: { search },
        },
      ],
    }).compile();

    service = module.get(MediaService);
  });

  it('findAll forwards keyword and page to XMDCentre.search', async () => {
    search.mockResolvedValue([]);
    await service.findAll({
      keyword: 'alpha',
      page: 3,
      sort: '',
      filter: '',
    });

    expect(search).toHaveBeenCalledWith('alpha', 3);
  });

  it('findAll sets isLastPage true when result count is below PER_PAGE_SIZE', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE - 1 }, () => mockMedia()));
    const out = await service.findAll({
      keyword: 'k',
      page: 1,
      sort: '',
      filter: '',
    });

    expect(out.medias).toHaveLength(PER_PAGE_SIZE - 1);
    expect(out.meta).toEqual({
      currentPage: 1,
      isLastPage: true,
    });
  });

  it('findAll sets isLastPage false when result count equals PER_PAGE_SIZE', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE }, () => mockMedia()));
    const out = await service.findAll({
      keyword: 'k',
      page: 2,
      sort: '',
      filter: '',
    });

    expect(out.medias).toHaveLength(PER_PAGE_SIZE);
    expect(out.meta).toEqual({
      currentPage: 2,
      isLastPage: false,
    });
  });

  it('propagates errors from XMDCentre.search', async () => {
    search.mockRejectedValue(new Error('upstream'));
    await expect(
      service.findAll({ keyword: 'k', page: 1, sort: '', filter: '' }),
    ).rejects.toThrow('upstream');
  });
});
