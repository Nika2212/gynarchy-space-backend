import { Injectable } from '@nestjs/common';
import { XMDCentre } from '../../centres/XMD.centre';
import { IFindAll } from '../../interfaces/query.interface';

@Injectable()
export class MediaService {
  private readonly XMDInstance: XMDCentre = new XMDCentre();

  public async findAll(query: IFindAll): Promise<unknown> {
    return '';
  }
}