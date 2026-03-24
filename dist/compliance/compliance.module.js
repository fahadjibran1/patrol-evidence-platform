"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const site_entity_1 = require("../sites/entities/site.entity");
const patrol_schedule_entity_1 = require("../patrol-schedules/entities/patrol-schedule.entity");
const patrol_slots_module_1 = require("../patrol-slots/patrol-slots.module");
const patrol_alerts_module_1 = require("../patrol-alerts/patrol-alerts.module");
const compliance_service_1 = require("./compliance.service");
const compliance_controller_1 = require("./compliance.controller");
let ComplianceModule = class ComplianceModule {
};
exports.ComplianceModule = ComplianceModule;
exports.ComplianceModule = ComplianceModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([site_entity_1.Site, patrol_schedule_entity_1.PatrolSchedule]),
            patrol_slots_module_1.PatrolSlotsModule,
            patrol_alerts_module_1.PatrolAlertsModule,
        ],
        providers: [compliance_service_1.ComplianceService],
        controllers: [compliance_controller_1.ComplianceController],
        exports: [compliance_service_1.ComplianceService],
    })
], ComplianceModule);
//# sourceMappingURL=compliance.module.js.map