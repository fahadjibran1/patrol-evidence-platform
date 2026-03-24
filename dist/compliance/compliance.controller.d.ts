import { ComplianceService, GenerateSlotsResult } from './compliance.service';
export declare class ComplianceController {
    private readonly complianceService;
    constructor(complianceService: ComplianceService);
    generateSlots(date: string): Promise<GenerateSlotsResult>;
    generateToday(): Promise<GenerateSlotsResult>;
}
