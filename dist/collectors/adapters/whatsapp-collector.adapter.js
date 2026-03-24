"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var WhatsAppCollectorAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppCollectorAdapter = void 0;
const common_1 = require("@nestjs/common");
let WhatsAppCollectorAdapter = WhatsAppCollectorAdapter_1 = class WhatsAppCollectorAdapter {
    constructor() {
        this.logger = new common_1.Logger(WhatsAppCollectorAdapter_1.name);
    }
    async ingestIncomingMedia(event) {
        const normalized = await this.normalizeIncomingEvent(event);
        this.logger.log(`Received WhatsApp media event ${normalized.messageExternalId ?? 'unknown'}`);
    }
    async normalizeIncomingEvent(event) {
        return {
            collectorType: 'WHATSAPP',
            externalGroupId: event.groupId,
            senderName: event.senderName,
            senderNumber: event.senderNumber,
            sentAt: new Date(event.sentAt),
            messageExternalId: event.messageId,
            mediaUrl: event.mediaUrl,
            mimeType: event.mimeType,
            originalFileName: event.fileName,
        };
    }
    async downloadMedia() {
        throw new Error('WhatsApp media download integration is intentionally deferred to Phase 3 adapter boundary.');
    }
    async mapSourceToSite() {
        throw new Error('WhatsApp site mapping integration is intentionally deferred to Phase 3 adapter boundary.');
    }
};
exports.WhatsAppCollectorAdapter = WhatsAppCollectorAdapter;
exports.WhatsAppCollectorAdapter = WhatsAppCollectorAdapter = WhatsAppCollectorAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], WhatsAppCollectorAdapter);
//# sourceMappingURL=whatsapp-collector.adapter.js.map