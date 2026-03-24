"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const schedule_1 = require("@nestjs/schedule");
const app_config_1 = require("./config/app.config");
const database_config_1 = require("./config/database.config");
const validate_env_1 = require("./config/validate-env");
const health_module_1 = require("./health/health.module");
const storage_module_1 = require("./storage/storage.module");
const sites_module_1 = require("./sites/sites.module");
const patrol_groups_module_1 = require("./patrol-groups/patrol-groups.module");
const patrol_schedules_module_1 = require("./patrol-schedules/patrol-schedules.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const patrol_alerts_module_1 = require("./patrol-alerts/patrol-alerts.module");
const patrol_images_module_1 = require("./patrol-images/patrol-images.module");
const patrol_slots_module_1 = require("./patrol-slots/patrol-slots.module");
const collectors_module_1 = require("./collectors/collectors.module");
const compliance_module_1 = require("./compliance/compliance.module");
const dashboard_module_1 = require("./dashboard/dashboard.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [app_config_1.appConfig, database_config_1.databaseConfig],
                validate: validate_env_1.validateEnv,
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                useFactory: () => ({
                    ...(0, database_config_1.databaseConfig)(),
                }),
            }),
            schedule_1.ScheduleModule.forRoot(),
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            health_module_1.HealthModule,
            storage_module_1.StorageModule,
            sites_module_1.SitesModule,
            patrol_groups_module_1.PatrolGroupsModule,
            patrol_schedules_module_1.PatrolSchedulesModule,
            patrol_images_module_1.PatrolImagesModule,
            patrol_slots_module_1.PatrolSlotsModule,
            patrol_alerts_module_1.PatrolAlertsModule,
            collectors_module_1.CollectorsModule,
            compliance_module_1.ComplianceModule,
            dashboard_module_1.DashboardModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map