"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolAlertsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const patrol_alert_entity_1 = require("./entities/patrol-alert.entity");
const patrol_alerts_service_1 = require("./patrol-alerts.service");
let PatrolAlertsModule = class PatrolAlertsModule {
};
exports.PatrolAlertsModule = PatrolAlertsModule;
exports.PatrolAlertsModule = PatrolAlertsModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([patrol_alert_entity_1.PatrolAlert])],
        providers: [patrol_alerts_service_1.PatrolAlertsService],
        exports: [patrol_alerts_service_1.PatrolAlertsService, typeorm_1.TypeOrmModule],
    })
], PatrolAlertsModule);
//# sourceMappingURL=patrol-alerts.module.js.map