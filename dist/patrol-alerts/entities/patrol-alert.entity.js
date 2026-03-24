"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolAlert = void 0;
const typeorm_1 = require("typeorm");
const site_entity_1 = require("../../sites/entities/site.entity");
const patrol_slot_entity_1 = require("../../patrol-slots/entities/patrol-slot.entity");
let PatrolAlert = class PatrolAlert {
};
exports.PatrolAlert = PatrolAlert;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PatrolAlert.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolAlert.prototype, "siteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => site_entity_1.Site, (site) => site.alerts, { onDelete: 'CASCADE' }),
    __metadata("design:type", site_entity_1.Site)
], PatrolAlert.prototype, "site", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolAlert.prototype, "slotId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => patrol_slot_entity_1.PatrolSlot, { onDelete: 'CASCADE' }),
    __metadata("design:type", patrol_slot_entity_1.PatrolSlot)
], PatrolAlert.prototype, "slot", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 60 }),
    __metadata("design:type", String)
], PatrolAlert.prototype, "alertType", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 255 }),
    __metadata("design:type", String)
], PatrolAlert.prototype, "alertMessage", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolAlert.prototype, "alertTime", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], PatrolAlert.prototype, "isResolved", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], PatrolAlert.prototype, "resolvedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PatrolAlert.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PatrolAlert.prototype, "updatedAt", void 0);
exports.PatrolAlert = PatrolAlert = __decorate([
    (0, typeorm_1.Entity)('patrol_alerts')
], PatrolAlert);
//# sourceMappingURL=patrol-alert.entity.js.map