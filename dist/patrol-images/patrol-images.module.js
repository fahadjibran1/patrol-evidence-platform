"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatrolImagesModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const patrol_image_entity_1 = require("./entities/patrol-image.entity");
const patrol_images_service_1 = require("./patrol-images.service");
const patrol_images_controller_1 = require("./patrol-images.controller");
const compliance_module_1 = require("../compliance/compliance.module");
const patrol_image_ingestion_service_1 = require("./patrol-image-ingestion.service");
const site_entity_1 = require("../sites/entities/site.entity");
const storage_module_1 = require("../storage/storage.module");
let PatrolImagesModule = class PatrolImagesModule {
};
exports.PatrolImagesModule = PatrolImagesModule;
exports.PatrolImagesModule = PatrolImagesModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([patrol_image_entity_1.PatrolImage, site_entity_1.Site]), compliance_module_1.ComplianceModule, storage_module_1.StorageModule],
        providers: [patrol_images_service_1.PatrolImagesService, patrol_image_ingestion_service_1.PatrolImageIngestionService],
        controllers: [patrol_images_controller_1.PatrolImagesController],
        exports: [patrol_images_service_1.PatrolImagesService, patrol_image_ingestion_service_1.PatrolImageIngestionService, typeorm_1.TypeOrmModule],
    })
], PatrolImagesModule);
//# sourceMappingURL=patrol-images.module.js.map