import { Site } from '@/sites/entities/site.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
export declare class PatrolGroup {
    id: string;
    siteId: string;
    site: Site;
    groupName: string;
    externalGroupId: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    images: PatrolImage[];
}
