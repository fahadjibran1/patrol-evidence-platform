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
exports.PatrolSlot = void 0;
const typeorm_1 = require("typeorm");
const site_entity_1 = require("../../sites/entities/site.entity");
const patrol_slot_status_enum_1 = require("../../common/enums/patrol-slot-status.enum");
const patrol_image_entity_1 = require("../../patrol-images/entities/patrol-image.entity");
let PatrolSlot = class PatrolSlot {
};
exports.PatrolSlot = PatrolSlot;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PatrolSlot.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid'),
    __metadata("design:type", String)
], PatrolSlot.prototype, "siteId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => site_entity_1.Site, (site) => site.slots, { onDelete: 'CASCADE' }),
    __metadata("design:type", site_entity_1.Site)
], PatrolSlot.prototype, "site", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolSlot.prototype, "slotStart", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolSlot.prototype, "slotEnd", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], PatrolSlot.prototype, "expectedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: patrol_slot_status_enum_1.PatrolSlotStatus, default: patrol_slot_status_enum_1.PatrolSlotStatus.PENDING }),
    __metadata("design:type", String)
], PatrolSlot.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)('uuid', { nullable: true }),
    __metadata("design:type", Object)
], PatrolSlot.prototype, "imageId", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => patrol_image_entity_1.PatrolImage, { nullable: true, onDelete: 'SET NULL' }),
    (0, typeorm_1.JoinColumn)({ name: 'imageId' }),
    __metadata("design:type", Object)
], PatrolSlot.prototype, "image", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], PatrolSlot.prototype, "resolvedAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PatrolSlot.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PatrolSlot.prototype, "updatedAt", void 0);
exports.PatrolSlot = PatrolSlot = __decorate([
    (0, typeorm_1.Entity)('patrol_slots')
], PatrolSlot);
//# sourceMappingURL=patrol-slot.entity.js.map