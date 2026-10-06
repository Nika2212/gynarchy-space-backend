import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ISettings } from '../shared/interfaces/settings.interface';
import { SettingsDocument } from './settings.schema';

@Injectable()
export class SettingsRepository {
  constructor(@InjectModel(SettingsDocument.name) private readonly settingsModel: Model<SettingsDocument>) {}

  // Defaults until the user changes something.
  public async find(): Promise<ISettings> {
    const row = await this.settingsModel.findOne().lean().exec();

    return this.toSettings(row);
  }

  // Creates the settings document on the first change.
  public async update(changes: Partial<ISettings>): Promise<ISettings> {
    const row = await this.settingsModel.findOneAndUpdate({}, { $set: changes }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean().exec();

    return this.toSettings(row);
  }

  private toSettings(row: Partial<ISettings> | null): ISettings {
    return {
      nativeSearch: row?.nativeSearch === true,
      randomizeFeed: row?.randomizeFeed === true,
    };
  }
}
