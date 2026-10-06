import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

// The user's preferences. The collection holds a single document.
@Schema({ collection: 'settings' })
export class SettingsDocument {
  @Prop({ required: true, default: false })
  nativeSearch: boolean;

  @Prop({ required: true, default: false })
  randomizeFeed: boolean;
}

export const SettingsSchema = SchemaFactory.createForClass(SettingsDocument);
