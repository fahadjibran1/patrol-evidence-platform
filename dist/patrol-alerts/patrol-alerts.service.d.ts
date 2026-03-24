import { Repository } from 'typeorm';
import { PatrolAlert } from './entities/patrol-alert.entity';
export declare class PatrolAlertsService {
    private readonly alertsRepo;
    constructor(alertsRepo: Repository<PatrolAlert>);
    createMissingAlert(params: {
        siteId: string;
        slotId: string;
        alertTime: Date;
        alertMessage: string;
    }): Promise<PatrolAlert>;
}
