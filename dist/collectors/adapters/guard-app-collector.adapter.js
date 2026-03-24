"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuardAppCollectorAdapter = void 0;
const common_1 = require("@nestjs/common");
let GuardAppCollectorAdapter = class GuardAppCollectorAdapter {
    async ingestIncomingMedia() {
        throw new Error('Guard app ingestion will be implemented in a future phase.');
    }
    async normalizeIncomingEvent() {
        throw new Error('Guard app event normalization will be implemented in a future phase.');
    }
    async downloadMedia() {
        throw new Error('Guard app media download will be implemented in a future phase.');
    }
    async mapSourceToSite() {
        throw new Error('Guard app source-site mapping will be implemented in a future phase.');
    }
};
exports.GuardAppCollectorAdapter = GuardAppCollectorAdapter;
exports.GuardAppCollectorAdapter = GuardAppCollectorAdapter = __decorate([
    (0, common_1.Injectable)()
], GuardAppCollectorAdapter);
//# sourceMappingURL=guard-app-collector.adapter.js.map