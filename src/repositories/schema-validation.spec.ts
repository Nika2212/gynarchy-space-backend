import mongoose from 'mongoose';
import { AlbumSchema } from './album.schema';
import { MediaSchema } from './media.schema';

// Runs Mongoose's own validation (no database), so rules like `required` are checked the way a real save checks them.
describe('schema validation', () => {
  const Media = mongoose.model('SchemaValidationMedia', MediaSchema);
  const Album = mongoose.model('SchemaValidationAlbum', AlbumSchema);

  it('accepts a media card with empty text fields', () => {
    const media = new Media({
      identifier: 'aHR0cHM6Ly9leGFtcGxlLmNvbS92',
      url: 'https://example.com/v',
      title: '',
      description: '',
      thumbnailSrc: '[]',
      previewSrc: '',
      postedAt: '',
      duration: 0,
      source: 'xmd',
    });

    expect(media.validateSync()).toBeUndefined();
  });

  it('still requires the identifier and url of a media', () => {
    const errors = new Media({ title: 'Title' }).validateSync()?.errors ?? {};

    expect(Object.keys(errors).sort()).toEqual(['identifier', 'url']);
  });

  it('accepts an album item with empty text fields, and still requires the album name and item identifier', () => {
    const valid = new Album({ name: 'Trips', items: [{ identifier: 'id', title: '', thumbnailSrc: '', postedAt: '', duration: 0, addedAt: new Date() }] });
    expect(valid.validateSync()).toBeUndefined();

    const errors = new Album({ name: '', items: [{ title: '', addedAt: new Date() }] }).validateSync()?.errors ?? {};
    expect(Object.keys(errors).sort()).toEqual(['items.0.identifier', 'name']);
  });
});
