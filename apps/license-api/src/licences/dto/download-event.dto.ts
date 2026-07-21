import { IsIn } from 'class-validator';

export class DownloadEventDto {
  @IsIn(['issue-success', 'licence-detail'])
  source!: 'issue-success' | 'licence-detail';
}
