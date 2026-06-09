import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';

export function inferPatrolSourceType(externalId: string): PatrolSourceType {
  if (externalId.endsWith('@c.us')) {
    return PatrolSourceType.CONTACT;
  }

  return PatrolSourceType.GROUP;
}
