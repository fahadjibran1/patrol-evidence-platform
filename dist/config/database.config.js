"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseConfig = void 0;
const site_entity_1 = require("../sites/entities/site.entity");
const patrol_group_entity_1 = require("../patrol-groups/entities/patrol-group.entity");
const patrol_schedule_entity_1 = require("../patrol-schedules/entities/patrol-schedule.entity");
const patrol_image_entity_1 = require("../patrol-images/entities/patrol-image.entity");
const patrol_slot_entity_1 = require("../patrol-slots/entities/patrol-slot.entity");
const patrol_alert_entity_1 = require("../patrol-alerts/entities/patrol-alert.entity");
const databaseConfig = () => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'patrol_evidence',
    entities: [site_entity_1.Site, patrol_group_entity_1.PatrolGroup, patrol_schedule_entity_1.PatrolSchedule, patrol_image_entity_1.PatrolImage, patrol_slot_entity_1.PatrolSlot, patrol_alert_entity_1.PatrolAlert],
    migrations: ['dist/database/migrations/*.js'],
    synchronize: false,
    logging: false,
});
exports.databaseConfig = databaseConfig;
//# sourceMappingURL=database.config.js.map